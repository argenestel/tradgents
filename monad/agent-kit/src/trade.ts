import { randomUUID } from 'node:crypto';
import { encodeFunctionData,formatUnits,keccak256,parseUnits,toBytes,type Address,type Hex,type PublicClient,type WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { SignerPolicy } from './policy.ts';
import { SpendLedger } from './spend-ledger.ts';
import { validateApprovalShape,validateIntent,validateSwapShape,type SwapIntent } from './validation.ts';
import { ERC20_ABI,PRICE_FEEDS,PYTH_ABI,PYTH_PRICE_FEED,ROUTER_ABI } from './venue.ts';

const MAX_UINT=(1n<<256n)-1n;
const NOW=()=>Date.now();
export interface TradeResult {approvalHash?:Hex;swapHash:Hex;amountInRaw:string;quotedOutRaw:string;minOutRaw:string;notionalUsd:number;intentId:string}
export interface TradeDeps {client:PublicClient;walletClient:WalletClient;account:PrivateKeyAccount;policy:SignerPolicy;ledger:SpendLedger;now?:()=>number}
interface Price {usd:number;publishTime:number;quality:'oracle'|'estimated'}
async function tokenPrice(client:PublicClient,symbol:'WMON'|'USDC',now:number,policy:SignerPolicy):Promise<Price> {
  const feed=PRICE_FEEDS[symbol];
  const p=await client.readContract({address:PYTH_PRICE_FEED,abi:PYTH_ABI,functionName:'getPriceUnsafe',args:[feed]});
  let usd=Number(p.price)*10**p.expo;const publishTime=Number(p.publishTime);
  const ageMs=now-publishTime*1000;let quality:Price['quality']=ageMs>=-60_000&&ageMs<=policy.maxPriceAgeSeconds*1000&&Number(p.conf)/Math.max(1,Number(p.price))<=0.01?'oracle':'estimated';
  if(symbol==='USDC'){
    if(usd>=0.97&&usd<=1.03)usd=1;
    else quality='estimated';
  }
  if(quality!=='oracle'||!Number.isFinite(usd)||usd<=0)throw new Error(`${symbol} price is stale or outside its trusted band`);
  return {usd,publishTime,quality};
}
export async function executeSwap(input:unknown,deps:TradeDeps):Promise<TradeResult> {
  const intent=validateIntent(input,deps.policy),now=(deps.now??NOW)(),nowSec=Math.floor(now/1000);
  const inputToken=deps.policy.tokens.find(t=>t.symbol===intent.tokenIn)!,outputToken=deps.policy.tokens.find(t=>t.symbol===intent.tokenOut)!;
  if(deps.account.address.toLowerCase()!==deps.policy.walletAddress.toLowerCase())throw new Error('signer key does not match policy wallet');
  const amountIn=parseUnits(intent.amount,inputToken.decimals);
  if(amountIn<=0n||amountIn>=MAX_UINT)throw new Error('amount is outside safe integer bounds');
  const price=await tokenPrice(deps.client,intent.tokenIn,now,deps.policy);
  const rawNotional=Number(formatUnits(amountIn,inputToken.decimals))*price.usd;
  if(!Number.isFinite(rawNotional)||rawNotional<=0)throw new Error('trade notional is outside safe USD bounds');
  const notionalUsd=Math.ceil(rawNotional*1_000_000)/1_000_000;
  const quote=await deps.client.readContract({address:deps.policy.router,abi:ROUTER_ABI,functionName:'getAmountsOut',args:[amountIn,[inputToken.address,outputToken.address]]});
  const quotedOut=quote[1];if(quotedOut<=0n)throw new Error('venue returned no output');
  const minOut=quotedOut*BigInt(10_000-intent.maxSlippageBps)/10_000n;if(minOut<=0n)throw new Error('minimum output rounds to zero');
  const deadline=nowSec+120;
  const swapData=encodeFunctionData({abi:ROUTER_ABI,functionName:'swapExactTokensForTokens',args:[amountIn,minOut,[inputToken.address,outputToken.address],deps.account.address,BigInt(deadline)]});
  const swapTx={to:deps.policy.router,data:swapData,value:0n};
  validateSwapShape(swapTx,deps.policy,intent,amountIn,minOut,deadline,nowSec);
  const gasPrice=await deps.client.getGasPrice();if(gasPrice>BigInt(deps.policy.maxGasPriceWei))throw new Error('gas price exceeds policy limit');
  const currentAllowance=await deps.client.readContract({address:inputToken.address,abi:ERC20_ABI,functionName:'allowance',args:[deps.account.address,deps.policy.router]});
  if(currentAllowance!==0n&&currentAllowance!==amountIn)throw new Error('existing router allowance is neither zero nor the exact trade amount');
  let approvalData:Hex|undefined;
  if(currentAllowance<amountIn){
    approvalData=encodeFunctionData({abi:ERC20_ABI,functionName:'approve',args:[deps.policy.router,amountIn]});
    validateApprovalShape({to:inputToken.address,data:approvalData,value:0n},deps.policy,intent.tokenIn,amountIn);
  }
  const intentId=randomUUID(),intentHash=keccak256(toBytes(JSON.stringify(intent)));
  // This fsync+rename happens before either approval or swap can be broadcast. Failed sends still consume the budget.
  deps.ledger.reserve(notionalUsd,intentId,intentHash,now);
  let approvalHash:Hex|undefined;
  if(approvalData){
    await deps.client.call({account:deps.account.address,to:inputToken.address,data:approvalData,value:0n});
    const approvalGas=await deps.client.estimateGas({account:deps.account.address,to:inputToken.address,data:approvalData,value:0n});
    if(approvalGas>BigInt(deps.policy.maxGasLimit))throw new Error('approval gas estimate exceeds policy limit');
    approvalHash=await deps.walletClient.sendTransaction({account:deps.account,chain:deps.walletClient.chain??null,to:inputToken.address,data:approvalData,value:0n,gas:approvalGas,gasPrice});
    const approvalReceipt=await deps.client.waitForTransactionReceipt({hash:approvalHash});
    if(approvalReceipt.status!=='success')throw new Error('exact-amount approval transaction failed');
  }
  // Simulate the complete exact-input swap from the agent wallet before signing/broadcasting it.
  await deps.client.call({account:deps.account.address,to:deps.policy.router,data:swapData,value:0n});
  const swapGas=await deps.client.estimateGas({account:deps.account.address,to:deps.policy.router,data:swapData,value:0n});
  if(swapGas>BigInt(deps.policy.maxGasLimit))throw new Error('swap gas estimate exceeds policy limit');
  const swapHash=await deps.walletClient.sendTransaction({account:deps.account,chain:deps.walletClient.chain??null,to:deps.policy.router,data:swapData,value:0n,gas:swapGas,gasPrice});
  const receipt=await deps.client.waitForTransactionReceipt({hash:swapHash});
  if(receipt.status!=='success')throw new Error('swap transaction failed; the spend budget remains reserved');
  return { ...(approvalHash?{approvalHash}:{}),swapHash,amountInRaw:amountIn.toString(),quotedOutRaw:quotedOut.toString(),minOutRaw:minOut.toString(),notionalUsd,intentId};
}
