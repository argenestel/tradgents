import { randomUUID } from 'node:crypto';
import { decodeFunctionResult, encodeFunctionData, formatUnits, keccak256, parseUnits, toBytes, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { SignerPolicy } from './policy.ts';
import { SpendLedger } from './spend-ledger.ts';
import { validateApprovalShape, validateIntent, validateSwapShape, type SwapIntent } from './validation.ts';
import { ERC20_ABI, FACTORY_ABI, PAIR_ABI, PRICE_FEEDS, PYTH_ABI, PYTH_PRICE_FEED, ROUTER_ABI } from './venue.ts';

const MAX_UINT=(1n<<256n)-1n;
const NOW=()=>Date.now();
const BALANCE_ABI=[{type:'function',name:'balanceOf',stateMutability:'view',inputs:[{name:'account',type:'address'}],outputs:[{type:'uint256'}]}] as const;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export interface TradeResult {approvalHash?:Hex;swapHash:Hex;amountInRaw:string;quotedOutRaw:string;minOutRaw:string;notionalUsd:number;intentId:string;poolLiquidityUsd:number;gasReserveUsd:number}
export interface TradeDeps {client:PublicClient;walletClient:WalletClient;account:PrivateKeyAccount;policy:SignerPolicy;ledger:SpendLedger;now?:()=>number}
interface Price {usd:number;publishTime:number;quality:'oracle'|'estimated'}
async function tokenPrice(client:PublicClient,symbol:'WMON'|'USDC',now:number,policy:SignerPolicy):Promise<Price> {
  const feed=PRICE_FEEDS[symbol];
  const p=await client.readContract({address:PYTH_PRICE_FEED,abi:PYTH_ABI,functionName:'getPriceUnsafe',args:[feed]});
  let usd=Number(p.price)*10**p.expo;const publishTime=Number(p.publishTime);
  const ageMs=now-publishTime*1000;let quality:Price['quality']=ageMs>=-60_000&&ageMs<=policy.maxPriceAgeSeconds[symbol]*1000&&Number(p.conf)/Math.max(1,Number(p.price))<=0.01?'oracle':'estimated';
  if(symbol==='USDC'){
    if(usd>=0.97&&usd<=1.03)usd=1;
    else quality='estimated';
  }
  if(quality!=='oracle'||!Number.isFinite(usd)||usd<=0)throw new Error(`${symbol} price is stale or outside its trusted band`);
  return {usd,publishTime,quality};
}
const ceilDiv=(n:bigint,d:bigint)=>n===0n?0n:(n+d-1n)/d;
export function oracleMinimumOutput(amountIn:bigint,inputDecimals:number,outputDecimals:number,inputUsd:number,outputUsd:number,toleranceBps:number):bigint {
  if(inputUsd<=0||outputUsd<=0||toleranceBps<0||toleranceBps>=10_000)throw new Error('invalid oracle output bounds');
  const scale=1_000_000_000_000n,inPrice=BigInt(Math.round(inputUsd*Number(scale))),outPrice=BigInt(Math.round(outputUsd*Number(scale)));
  const numerator=amountIn*inPrice*10n**BigInt(outputDecimals)*BigInt(10_000-toleranceBps);
  const denominator=10n**BigInt(inputDecimals)*outPrice*10_000n;
  return ceilDiv(numerator,denominator);
}
function human(raw:bigint,decimals:number):number{return Number(formatUnits(raw,decimals));}
async function pairLiquidity(client:PublicClient,policy:SignerPolicy,input:SignerPolicy['tokens'][number],output:SignerPolicy['tokens'][number],inPrice:number,outPrice:number):Promise<{pair:Address;usd:number}> {
  const pair=await client.readContract({address:policy.factory,abi:FACTORY_ABI,functionName:'getPair',args:[input.address,output.address]});
  if(same(pair,'0x0000000000000000000000000000000000000000'))throw new Error('no Uniswap V2 pool exists for this pair');
  const [token0,token1,reserves]=await Promise.all([
    client.readContract({address:pair,abi:PAIR_ABI,functionName:'token0'}),
    client.readContract({address:pair,abi:PAIR_ABI,functionName:'token1'}),
    client.readContract({address:pair,abi:PAIR_ABI,functionName:'getReserves'}),
  ]);
  const [reserve0,reserve1]=reserves;
  const inputIs0=same(token0,input.address);
  if(!(inputIs0&&same(token1,output.address))&&!(same(token0,output.address)&&same(token1,input.address)))throw new Error('pool tokens do not match the checked pair');
  const usd=inputIs0
    ?human(reserve0,input.decimals)*inPrice+human(reserve1,output.decimals)*outPrice
    :human(reserve0,output.decimals)*outPrice+human(reserve1,input.decimals)*inPrice;
  if(!Number.isFinite(usd)||usd<policy.minPoolLiquidityUsd)throw new Error(`pool liquidity $${Number.isFinite(usd)?usd.toFixed(2):'invalid'} is below the $${policy.minPoolLiquidityUsd} floor`);
  return {pair,usd};
}
interface TraceAccount {balance?:string;nonce?:string;code?:string;storage?:Record<string,string>}
interface TraceDiff {pre?:Record<string,TraceAccount>;post?:Record<string,TraceAccount>}
type StateOverride=Record<string,{balance?:Hex;nonce?:Hex;code?:Hex;stateDiff?:Record<string,Hex>}>;
async function tracedStateOverride(client:PublicClient,tx:{from:Address;to:Address;data:Hex;value:bigint}):Promise<StateOverride> {
  const request=client.request as unknown as (args:{method:string;params:unknown[]},options?:{signal?:AbortSignal})=>Promise<unknown>;
  const trace=await request({method:'debug_traceCall',params:[{from:tx.from,to:tx.to,data:tx.data,value:`0x${tx.value.toString(16)}`},'latest',{tracer:'prestateTracer',tracerConfig:{diffMode:true}}]}) as TraceDiff;
  if(!trace||!trace.post||typeof trace.post!=='object')throw new Error('RPC did not provide simulated post-state; refusing unverified trade');
  const override:StateOverride={};
  for(const [address,state] of Object.entries(trace.post)){
    const item:StateOverride[string]={};
    if(state.balance)item.balance=state.balance as Hex;
    if(state.nonce)item.nonce=state.nonce as Hex;
    if(state.code)item.code=state.code as Hex;
    if(state.storage&&Object.keys(state.storage).length)item.stateDiff=Object.fromEntries(Object.entries(state.storage).map(([k,v])=>[k,v as Hex]));
    override[address]=item;
  }
  return override;
}
async function simulatedRead(client:PublicClient,address:Address,data:Hex,override:StateOverride):Promise<bigint> {
  const request=client.request as unknown as (args:{method:string;params:unknown[]})=>Promise<Hex>;
  const result=await request({method:'eth_call',params:[{to:address,data},'latest',override]});
  return decodeFunctionResult({abi:ERC20_ABI,functionName:data.slice(0,10)==='0xdd62ed3e'?'allowance':'balanceOf',data:result});
}
async function readSimulatedBalance(client:PublicClient,token:Address,wallet:Address,override:StateOverride):Promise<bigint> {
  const data=encodeFunctionData({abi:BALANCE_ABI,functionName:'balanceOf',args:[wallet]});
  return simulatedRead(client,token,data,override);
}
async function readSimulatedAllowance(client:PublicClient,token:Address,wallet:Address,router:Address,override:StateOverride):Promise<bigint> {
  const data=encodeFunctionData({abi:ERC20_ABI,functionName:'allowance',args:[wallet,router]});
  return simulatedRead(client,token,data,override);
}
async function simulateApproval(client:PublicClient,policy:SignerPolicy,token:SignerPolicy['tokens'][number],data:Hex,amount:bigint):Promise<void> {
  const before=await Promise.all(policy.tokens.map(t=>client.readContract({address:t.address,abi:ERC20_ABI,functionName:'balanceOf',args:[policy.walletAddress]})));
  await client.call({account:policy.walletAddress,to:token.address,data,value:0n});
  const override=await tracedStateOverride(client,{from:policy.walletAddress,to:token.address,data,value:0n});
  const allowed=new Set([policy.walletAddress.toLowerCase(),token.address.toLowerCase()]);
  if(Object.keys(override).some(address=>!allowed.has(address.toLowerCase())))throw new Error('approval simulation changed an unexpected contract state');
  const after=await Promise.all(policy.tokens.map(t=>readSimulatedBalance(client,t.address,policy.walletAddress,override)));
  if(after.some((balance,i)=>balance!==before[i]))throw new Error('approval simulation moved a wallet token balance');
  if(await readSimulatedAllowance(client,token.address,policy.walletAddress,policy.router,override)!==amount)throw new Error('approval simulation did not set the exact router allowance');
}
async function simulateSwap(client:PublicClient,policy:SignerPolicy,input:SignerPolicy['tokens'][number],output:SignerPolicy['tokens'][number],pair:Address,data:Hex,amountIn:bigint,minOut:bigint):Promise<void> {
  const before=await Promise.all(policy.tokens.map(t=>client.readContract({address:t.address,abi:ERC20_ABI,functionName:'balanceOf',args:[policy.walletAddress]})));
  await client.call({account:policy.walletAddress,to:policy.router,data,value:0n});
  const override=await tracedStateOverride(client,{from:policy.walletAddress,to:policy.router,data,value:0n});
  const allowed=new Set([policy.walletAddress,policy.router,input.address,output.address,pair].map(a=>a.toLowerCase()));
  if(Object.keys(override).some(address=>!allowed.has(address.toLowerCase())))throw new Error('swap simulation changed an unexpected contract state');
  const after=await Promise.all(policy.tokens.map(t=>readSimulatedBalance(client,t.address,policy.walletAddress,override)));
  const inIndex=policy.tokens.findIndex(t=>same(t.address,input.address)),outIndex=policy.tokens.findIndex(t=>same(t.address,output.address));
  if(inIndex<0||outIndex<0||before[inIndex]-after[inIndex]!==amountIn||after[outIndex]-before[outIndex]<minOut)throw new Error('swap simulation balances do not match the checked input and minimum output');
  if(after.some((balance,i)=>i!==inIndex&&i!==outIndex&&balance!==before[i]))throw new Error('swap simulation moved an unexpected wallet token balance');
  if(await readSimulatedAllowance(client,input.address,policy.walletAddress,policy.router,override)!==0n)throw new Error('swap simulation left an unexpected router allowance');
}
function gasUsd(gasLimit:bigint,gasPrice:bigint,monUsd:number):number {
  const wei=gasLimit*gasPrice;
  return Number(formatUnits(wei,18))*monUsd;
}
export async function executeSwap(input:unknown,deps:TradeDeps):Promise<TradeResult> {
  const intent=validateIntent(input,deps.policy),now=(deps.now??NOW)(),nowSec=Math.floor(now/1000);
  const inputToken=deps.policy.tokens.find(t=>t.symbol===intent.tokenIn)!,outputToken=deps.policy.tokens.find(t=>t.symbol===intent.tokenOut)!;
  if(deps.account.address.toLowerCase()!==deps.policy.walletAddress.toLowerCase())throw new Error('signer key does not match policy wallet');
  const amountIn=parseUnits(intent.amount,inputToken.decimals);
  if(amountIn<=0n||amountIn>=MAX_UINT)throw new Error('amount is outside safe integer bounds');
  const [inputPrice,outputPrice]=await Promise.all([tokenPrice(deps.client,intent.tokenIn,now,deps.policy),tokenPrice(deps.client,intent.tokenOut,now,deps.policy)]);
  const rawNotional=human(amountIn,inputToken.decimals)*inputPrice.usd;
  if(!Number.isFinite(rawNotional)||rawNotional<=0)throw new Error('trade notional is outside safe USD bounds');
  const notionalUsd=Math.ceil(rawNotional*1_000_000)/1_000_000;
  const liquidity=await pairLiquidity(deps.client,deps.policy,inputToken,outputToken,inputPrice.usd,outputPrice.usd);
  const quote=await deps.client.readContract({address:deps.policy.router,abi:ROUTER_ABI,functionName:'getAmountsOut',args:[amountIn,[inputToken.address,outputToken.address]]});
  const quotedOut=quote[1];if(quotedOut<=0n)throw new Error('venue returned no output');
  const oracleMin=oracleMinimumOutput(amountIn,inputToken.decimals,outputToken.decimals,inputPrice.usd,outputPrice.usd,intent.maxSlippageBps);
  if(quotedOut<oracleMin)throw new Error('venue quote is below the oracle value after the permitted deviation');
  const quotedMin=quotedOut*BigInt(10_000-intent.maxSlippageBps)/10_000n;
  const minOut=oracleMin>quotedMin?oracleMin:quotedMin;if(minOut<=0n)throw new Error('minimum output rounds to zero');
  const deadline=nowSec+120;
  const swapData=encodeFunctionData({abi:ROUTER_ABI,functionName:'swapExactTokensForTokens',args:[amountIn,minOut,[inputToken.address,outputToken.address],deps.account.address,BigInt(deadline)]});
  const swapTx={to:deps.policy.router,data:swapData,value:0n};
  validateSwapShape(swapTx,deps.policy,intent,amountIn,minOut,deadline,nowSec);
  const gasPrice=await deps.client.getGasPrice();if(gasPrice>BigInt(deps.policy.maxGasPriceWei))throw new Error('gas price exceeds policy limit');
  const maxGas=BigInt(deps.policy.maxGasLimit);
  const currentAllowance=await deps.client.readContract({address:inputToken.address,abi:ERC20_ABI,functionName:'allowance',args:[deps.account.address,deps.policy.router]});
  if(currentAllowance!==0n&&currentAllowance!==amountIn)throw new Error('existing router allowance is neither zero nor the exact trade amount');
  let approvalData:Hex|undefined,approvalGas=0n;
  if(currentAllowance<amountIn){
    approvalData=encodeFunctionData({abi:ERC20_ABI,functionName:'approve',args:[deps.policy.router,amountIn]});
    validateApprovalShape({to:inputToken.address,data:approvalData,value:0n},deps.policy,intent.tokenIn,amountIn);
    // Every simulation which can run before the first broadcast runs before a reservation is committed.
    await simulateApproval(deps.client,deps.policy,inputToken,approvalData,amountIn);
    approvalGas=await deps.client.estimateGas({account:deps.account.address,to:inputToken.address,data:approvalData,value:0n});
    if(approvalGas>maxGas)throw new Error('approval gas estimate exceeds policy limit');
  }
  let swapGas:bigint;
  if(!approvalData){
    await simulateSwap(deps.client,deps.policy,inputToken,outputToken,liquidity.pair,swapData,amountIn,minOut);
    swapGas=await deps.client.estimateGas({account:deps.account.address,to:deps.policy.router,data:swapData,value:0n});
    if(swapGas>maxGas)throw new Error('swap gas estimate exceeds policy limit');
  } else {
    // The exact swap limit is unavailable until the approval is mined. Reserve the policy maximum up front.
    swapGas=maxGas;
  }
  const monPrice=intent.tokenIn==='WMON'?inputPrice.usd:outputPrice.usd; // WMON's Pyth feed is MON/USD.
  const gasReserveUsd=gasUsd(approvalGas+swapGas,gasPrice,monPrice);
  const totalReservationUsd=Math.ceil((notionalUsd+gasReserveUsd)*1_000_000)/1_000_000;
  const intentId=randomUUID(),intentHash=keccak256(toBytes(JSON.stringify(intent)));
  deps.ledger.reserve(totalReservationUsd,intentId,intentHash,now,{poolLiquidityUsd:liquidity.usd,gasReserveUsd});
  let approvalHash:Hex|undefined;
  if(approvalData){
    approvalHash=await deps.walletClient.sendTransaction({account:deps.account,chain:deps.walletClient.chain??null,to:inputToken.address,data:approvalData,value:0n,gas:approvalGas,gasPrice});
    const approvalReceipt=await deps.client.waitForTransactionReceipt({hash:approvalHash});
    if(approvalReceipt.status!=='success')throw new Error('exact-amount approval transaction failed; spend budget remains reserved');
    // The post-state check is now based on the mined exact approval; this can fail only after a transaction was sent.
    await simulateSwap(deps.client,deps.policy,inputToken,outputToken,liquidity.pair,swapData,amountIn,minOut);
    swapGas=await deps.client.estimateGas({account:deps.account.address,to:deps.policy.router,data:swapData,value:0n});
    if(swapGas>maxGas)throw new Error('swap gas estimate exceeds policy limit');
  }
  const swapHash=await deps.walletClient.sendTransaction({account:deps.account,chain:deps.walletClient.chain??null,to:deps.policy.router,data:swapData,value:0n,gas:swapGas,gasPrice});
  const receipt=await deps.client.waitForTransactionReceipt({hash:swapHash});
  if(receipt.status!=='success')throw new Error('swap transaction failed; the spend budget remains reserved');
  return { ...(approvalHash?{approvalHash}:{}),swapHash,amountInRaw:amountIn.toString(),quotedOutRaw:quotedOut.toString(),minOutRaw:minOut.toString(),notionalUsd,intentId,poolLiquidityUsd:liquidity.usd,gasReserveUsd};
}
