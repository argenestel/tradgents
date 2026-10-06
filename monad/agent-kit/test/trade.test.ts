import { mkdtempSync,chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect,it } from 'vitest';
import { createWalletClient } from 'viem';
import type { PublicClient,WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { DEFAULT_POLICY,parsePolicy } from '../src/policy.ts';
import { SpendLedger } from '../src/spend-ledger.ts';
import { executeSwap } from '../src/trade.ts';
import { PRICE_FEEDS } from '../src/venue.ts';

const wallet='0x00000000000000000000000000000000000000aa' as const,account={address:wallet} as unknown as PrivateKeyAccount;
function setup(){const dir=mkdtempSync(join(tmpdir(),'trade-test-'));chmodSync(dir,0o700);const policy=parsePolicy({...DEFAULT_POLICY,walletAddress:wallet,perTradeLimitUsd:50,perDayLimitUsd:100});return {dir,policy};}
function mocked(failCall=false,allowance=0n){
  let sends=0;const now=Date.now();
  const client={
    readContract:async(args:{functionName:string;args?:readonly unknown[]})=>{
      if(args.functionName==='getPriceUnsafe')return {price:args.args?.[0]===PRICE_FEEDS.WMON?100n:100n,conf:0n,expo:0,publishTime:BigInt(Math.floor(now/1000))};
      if(args.functionName==='getAmountsOut')return [args.args?.[0]??0n,100_000_000n];
      if(args.functionName==='allowance')return allowance;
      throw new Error('unexpected read');
    },call:async()=>{if(failCall)throw new Error('fixture eth_call reverted');return {};},estimateGas:async()=>100_000n,getGasPrice:async()=>1_000_000_000n,
    waitForTransactionReceipt:async()=>({status:'success'}),
  } as unknown as PublicClient;
  const walletClient={sendTransaction:async()=>{sends++;return `0x${String(sends).padStart(64,'0')}`;}} as unknown as WalletClient;
  return {client,walletClient,sent:()=>sends,now};
}
const intent={type:'swap',tokenIn:'WMON',tokenOut:'USDC',amount:'0.1',maxSlippageBps:50};
it('simulates exact approval and swap, reserves the budget before the first send',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked();
  const result=await executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now});
  expect(result.swapHash).toMatch(/^0x/);expect(result.approvalHash).toMatch(/^0x/);expect(m.sent()).toBe(2);
  expect(ledger.read(m.now).usedUsd).toBe(10);expect(result.amountInRaw).toBe('100000000000000000');
});
it('rejects a nonzero stale or oversized router allowance',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked(false,1n);
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/allowance/);
  expect(m.sent()).toBe(0);expect(ledger.read(m.now).usedUsd).toBe(0);
});
it('records the attempted spend before simulation and fails closed when eth_call fails',async()=>{ 
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked(true);
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/eth_call/);
  expect(ledger.read(m.now).usedUsd).toBe(10);expect(m.sent()).toBe(0);
});
it('does not send when the daily budget is already exhausted',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked();ledger.reserve(50,'prior-1',`0x${'01'.repeat(32)}`,m.now);ledger.reserve(45,'prior-2',`0x${'02'.repeat(32)}`,m.now);
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account,policy,ledger,now:()=>m.now})).rejects.toThrow(/per-day/);
  expect(m.sent()).toBe(0);expect(ledger.read(m.now).usedUsd).toBe(95);
});
it('refuses a signer wallet that does not match policy before any RPC send',async()=>{
  const {dir,policy}=setup(),ledger=new SpendLedger(dir,policy),m=mocked(),other={address:'0x00000000000000000000000000000000000000bb'} as unknown as PrivateKeyAccount;
  await expect(executeSwap(intent,{client:m.client,walletClient:m.walletClient,account:other,policy,ledger,now:()=>m.now})).rejects.toThrow(/does not match/);expect(m.sent()).toBe(0);
});
