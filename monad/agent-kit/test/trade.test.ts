import { mkdtempSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect,it } from 'vitest';
import { decodeFunctionData,encodeFunctionResult,type PublicClient, type WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { DEFAULT_POLICY,parsePolicy } from '../src/policy.ts';
import { SpendLedger } from '../src/spend-ledger.ts';
import { executeSwap } from '../src/trade.ts';
import { ERC20_ABI,PRICE_FEEDS,USDC,WMON } from '../src/venue.ts';

const wallet='0x00000000000000000000000000000000000000aa' as const,account={address:wallet} as unknown as PrivateKeyAccount;
const pair='0x00000000000000000000000000000000000000cc' as const;
function setup(patch:Record<string,unknown>={}){const dir=mkdtempSync(join(tmpdir(),'trade-test-'));chmodSync(dir,0o700);const policy=parsePolicy({...DEFAULT_POLICY,walletAddress:wallet,perTradeLimitUsd:50,perDayLimitUsd:100,...patch});return {dir,policy};}
function mocked(options:{failCall?:boolean;allowance?:bigint;quote?:bigint;reserves?:[bigint,bigint];extraMover?:boolean}={}){
  let sends=0,allowance=options.allowance??0n,trace=0;const now=Date.now(),inputRaw=100_000_000_000_000_000n,outputRaw=options.quote??10_000_000n;
  const client={
    readContract:async(args:{address:string;functionName:string;args?:readonly unknown[]})=>{
      if(args.functionName==='getPriceUnsafe')return {price:args.args?.[0]===PRICE_FEEDS.WMON?100n:1n,conf:0n,expo:0,publishTime:BigInt(Math.floor(now/1000))};
      if(args.functionName==='getAmountsOut')return [args.args?.[0]??0n,outputRaw];
      if(args.functionName==='getPair')return pair;
      if(args.functionName==='token0')return WMON;
      if(args.functionName==='token1')return USDC;
      if(args.functionName==='getReserves')return options.reserves??[1_000n*10n**18n,100_000n*10n**6n,0];
      if(args.functionName==='allowance')return allowance;
      if(args.functionName==='balanceOf')return args.address.toLowerCase()===WMON.toLowerCase()?10n**18n:0n;
      throw new Error(`unexpected read ${args.functionName}`);
    },call:async()=>{if(options.failCall)throw new Error('fixture eth_call reverted');return {};},estimateGas:async()=>100_000n,getGasPrice:async()=>1_000_000_000n,
    waitForTransactionReceipt:async()=>({status:'success'}),
    request:async({method,params}:{method:string;params:unknown[]})=>{
      if(method==='debug_traceCall'){trace++;return {pre:{},post:options.extraMover?{'0x00000000000000000000000000000000000000ee':{storage:{'0x01':'0x02'}}}:{}};}
      if(method==='eth_call'){
        const call=params[0] as {to:string;data:`0x${string}`},decoded=decodeFunctionData({abi:ERC20_ABI,data:call.data});
        if(decoded.functionName==='allowance')return encodeFunctionResult({abi:ERC20_ABI,functionName:'allowance',result:trace===1?inputRaw:0n});
        if(decoded.functionName==='balanceOf'){
          const token=call.to.toLowerCase(),isInput=token===WMON.toLowerCase();
          const value=trace>1?isInput?10n**18n-inputRaw:outputRaw:isInput?10n**18n:0n;
          return encodeFunctionResult({abi:ERC20_ABI,functionName:'balanceOf',result:value});
        }
      }
      throw new Error(`unexpected RPC ${method}`);
    },
  } as unknown as PublicClient;
  const walletClient={sendTransaction:async(tx:{to:string;data:`0x${string}`})=>{sends++;if(tx.to.toLowerCase()===WMON.toLowerCase()){const decoded=decodeFunctionData({abi:ERC20_ABI,data:tx.data});if(decoded.functionName==='approve')allowance=decoded.args[1];}return `0x${String(sends).padStart(64,'0')}`;}} as unknown as WalletClient;
  return {client,walletClient,sent:()=>sends,now};
}
const intent={type:'swap',tokenIn:'WMON',tokenOut:'USDC',amount:'0.1',maxSlippageBps:50};
it('simulates exact approval and swap, reserves notional plus bounded gas before the first send',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked();
  const result=await executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now});
  expect(result.swapHash).toMatch(/^0x/);expect(result.approvalHash).toMatch(/^0x/);expect(m.sent()).toBe(2);
  expect(ledger.read(m.now).usedUsd).toBe(10.06);expect(result.amountInRaw).toBe('100000000000000000');
  expect(result.poolLiquidityUsd).toBe(200_000);expect(result.minOutRaw).toBe('9950000');
  expect(ledger.read(m.now).trades[0]).toMatchObject({poolLiquidityUsd:200_000,gasReserveUsd:0.06});
});
it('rejects a manipulated quote below the oracle minimum without reserving or sending',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked({quote:1_000_000n});
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/oracle value/);
  expect(m.sent()).toBe(0);expect(ledger.read(m.now).usedUsd).toBe(0);
});
it('rejects a pool whose oracle-priced reserves are below the configured USD floor',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked({reserves:[1n,1n]});
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/liquidity/);
  expect(m.sent()).toBe(0);expect(ledger.read(m.now).usedUsd).toBe(0);
});
it('rejects a nonzero stale or oversized router allowance',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked({allowance:1n});
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/allowance/);
  expect(m.sent()).toBe(0);expect(ledger.read(m.now).usedUsd).toBe(0);
});
it('rejects simulated state changes outside the wallet, pair and approved token set',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked({allowance:100_000_000_000_000_000n,extraMover:true});
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/unexpected contract state/);
  expect(m.sent()).toBe(0);expect(ledger.read(m.now).usedUsd).toBe(0);
});
it('releases no budget when a simulation fails before any transaction is broadcast',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked({failCall:true});
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/eth_call/);
  expect(ledger.read(m.now).usedUsd).toBe(0);expect(m.sent()).toBe(0);
});
it('does not send when the daily budget including gas is already exhausted',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked();ledger.reserve(50,'prior-1',`0x${'01'.repeat(32)}`,m.now);ledger.reserve(45,'prior-2',`0x${'02'.repeat(32)}`,m.now);
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/per-day/);
  expect(m.sent()).toBe(0);expect(ledger.read(m.now).usedUsd).toBe(95);
});
it('refuses a signer wallet that does not match policy before any RPC send',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked(),other={address:'0x00000000000000000000000000000000000000bb'} as unknown as PrivateKeyAccount;
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account:other,policy,ledger,now:()=>m.now})).rejects.toThrow(/does not match/);expect(m.sent()).toBe(0);
});
