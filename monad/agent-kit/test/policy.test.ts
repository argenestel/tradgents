import { mkdtempSync,writeFileSync,chmodSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect,it } from 'vitest';
import { DEFAULT_POLICY,assertRootOwnedPolicyFile,parsePolicy } from '../src/policy.ts';
import { assertSocketMode } from '../src/signer.ts';
import { assertTradeLimits,validateApprovalShape,validateIntent,validateSwapShape } from '../src/validation.ts';
import { encodeFunctionData,type Address } from 'viem';
import { ERC20_ABI,ROUTER_ABI,USDC,UNISWAP_V2_ROUTER,WMON } from '../src/venue.ts';

const wallet='0x00000000000000000000000000000000000000aa' as Address;
function withPolicy(patch:Record<string,unknown>={}){return parsePolicy({...DEFAULT_POLICY,walletAddress:wallet,...patch});}
it('pins the mainnet router and token set in a strict policy',()=>{
  const p=withPolicy();expect(p.chainId).toBe(143);expect(p.router).toBe(UNISWAP_V2_ROUTER);
  expect(()=>parsePolicy({...DEFAULT_POLICY,router:'0x0000000000000000000000000000000000000099'})).toThrow(/pinned/);
  expect(()=>parsePolicy({...DEFAULT_POLICY,tokens:[...DEFAULT_POLICY.tokens,{symbol:'BAD',address:wallet,decimals:18}]})).toThrow();
  expect(()=>parsePolicy({...DEFAULT_POLICY,perTradeLimitUsd:-1})).toThrow();
  expect(parsePolicy(DEFAULT_POLICY).maxPriceAgeSeconds).toEqual({WMON:3600,USDC:3600});
  expect(()=>parsePolicy({...DEFAULT_POLICY,maxSlippageBps:101})).toThrow();
});
it('selects a separate testnet signer profile and never accepts mainnet pins for it',()=>{
  const env={MONAD_NETWORK:'testnet',TESTNET_V2_ROUTER:'0x0000000000000000000000000000000000000011',TESTNET_V2_FACTORY:'0x0000000000000000000000000000000000000012',TESTNET_USDC:'0x0000000000000000000000000000000000000013'};
  const p=parsePolicy({...DEFAULT_POLICY,network:'testnet',chainId:10143,router:env.TESTNET_V2_ROUTER,factory:env.TESTNET_V2_FACTORY,tokens:[{symbol:'WMON',address:'0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541',decimals:18},{symbol:'USDC',address:env.TESTNET_USDC,decimals:6}]},env);
  expect(p.network).toBe('testnet');expect(p.chainId).toBe(10143);expect(p.router).toBe(env.TESTNET_V2_ROUTER);
  expect(()=>parsePolicy({...DEFAULT_POLICY,network:'testnet',chainId:143},env)).toThrow(/does not match.*10143/);
  expect(()=>parsePolicy(DEFAULT_POLICY,env)).toThrow(/does not match MONAD_NETWORK/);
});
it('requires a regular root-owned, non-writable policy file',()=>{
  const dir=mkdtempSync(join(tmpdir(),'policy-test-')),path=join(dir,'policy.json');writeFileSync(path,JSON.stringify(DEFAULT_POLICY),{mode:0o600});
  const own=process.getuid?.()??-1;expect(()=>assertRootOwnedPolicyFile(path,own)).not.toThrow();expect(()=>assertRootOwnedPolicyFile(path,0)).toThrow(/owned by uid 0/);
  chmodSync(path,0o640);expect(()=>assertRootOwnedPolicyFile(path,own)).not.toThrow();
  chmodSync(path,0o644);expect(()=>assertRootOwnedPolicyFile(path,own)).toThrow(/world-readable/);
  chmodSync(path,0o666);expect(()=>assertRootOwnedPolicyFile(path,own)).toThrow(/permissions/);
  const link=join(dir,'link');symlinkSync(path,link);expect(()=>assertRootOwnedPolicyFile(link,own)).toThrow();
});
it('only permits a 0660 signer socket when an explicit group ID is configured',()=>{
  expect(()=>assertSocketMode('0600')).not.toThrow();
  expect(()=>assertSocketMode('0660')).toThrow(/GID/);
  expect(()=>assertSocketMode('0660',123)).not.toThrow();
});
it('enforces input token allowlist, amount format/precision and slippage caps',()=>{
  const p=withPolicy();expect(validateIntent({type:'swap',tokenIn:'WMON',tokenOut:'USDC',amount:'0.125',maxSlippageBps:50},p).amount).toBe('0.125');
  for(const input of [
    {type:'swap',tokenIn:'MON',tokenOut:'USDC',amount:'1',maxSlippageBps:50},
    {type:'swap',tokenIn:'USDC',tokenOut:'USDC',amount:'1',maxSlippageBps:50},
    {type:'swap',tokenIn:'WMON',tokenOut:'USDC',amount:'1.0000000000000000001',maxSlippageBps:50},
    {type:'swap',tokenIn:'WMON',tokenOut:'USDC',amount:'1',maxSlippageBps:101},
    {type:'swap',tokenIn:'WMON',tokenOut:'USDC',amount:'1e5',maxSlippageBps:50},
  ])expect(()=>validateIntent(input,p)).toThrow();
});
it('enforces both per-trade and per-day USD limits',()=>{
  const p=withPolicy({perTradeLimitUsd:10,perDayLimitUsd:25});
  expect(()=>assertTradeLimits(p,0,10)).not.toThrow();
  expect(()=>assertTradeLimits(p,0,10.01)).toThrow(/per-trade/);
  expect(()=>assertTradeLimits(p,20,5)).not.toThrow();
  expect(()=>assertTradeLimits(p,20,5.01)).toThrow(/per-day/);
  expect(()=>assertTradeLimits(p,0,0)).toThrow(/positive/);
});
it('accepts only exact approval to the pinned router; rejects max, wrong spender and shapes',()=>{
  const p=withPolicy(),amount=123456n;
  const data=encodeFunctionData({abi:ERC20_ABI,functionName:'approve',args:[p.router,amount]});
  expect(()=>validateApprovalShape({to:USDC,data,value:0n},p,'USDC',amount)).not.toThrow();
  const max=encodeFunctionData({abi:ERC20_ABI,functionName:'approve',args:[p.router,(1n<<256n)-1n]});
  expect(()=>validateApprovalShape({to:USDC,data:max,value:0n},p,'USDC',amount)).toThrow(/exact trade amount/);
  const other=encodeFunctionData({abi:ERC20_ABI,functionName:'approve',args:[wallet,amount]});
  expect(()=>validateApprovalShape({to:USDC,data:other,value:0n},p,'USDC',amount)).toThrow(/spender/);
  expect(()=>validateApprovalShape({to:wallet,data,value:0n},p,'USDC',amount)).toThrow(/target/);
  expect(()=>validateApprovalShape({to:USDC,data,value:1n},p,'USDC',amount)).toThrow(/target/);
  const transfer=encodeFunctionData({abi:ERC20_ABI,functionName:'approve',args:[p.router,amount]});
  expect(()=>validateApprovalShape({to:USDC,data:transfer.slice(0,10)+'dead'.padEnd(64,'0') as `0x${string}`,value:0n},p,'USDC',amount)).toThrow(/calldata/);
});
it('decodes complete router calldata and checks recipient, path, amounts, deadline and value',()=>{
  const p=withPolicy(),intent=validateIntent({type:'swap',tokenIn:'WMON',tokenOut:'USDC',amount:'1',maxSlippageBps:50},p),amount=10n**18n,min=99_000_000n,deadline=1200;
  const data=encodeFunctionData({abi:ROUTER_ABI,functionName:'swapExactTokensForTokens',args:[amount,min,[WMON,USDC],wallet,BigInt(deadline)]});
  expect(()=>validateSwapShape({to:p.router,data,value:0n},p,intent,amount,min,deadline,1000)).not.toThrow();
  expect(()=>validateSwapShape({to:p.router,data,value:0n},p,intent,amount,min,deadline,1200)).toThrow(/deadline/);
  const wrongRecipient=encodeFunctionData({abi:ROUTER_ABI,functionName:'swapExactTokensForTokens',args:[amount,min,[WMON,USDC],p.registryAddress,BigInt(deadline)]});
  expect(()=>validateSwapShape({to:p.router,data:wrongRecipient,value:0n},p,intent,amount,min,deadline,1000)).toThrow(/recipient/);
  const wrongPath=encodeFunctionData({abi:ROUTER_ABI,functionName:'swapExactTokensForTokens',args:[amount,min,[USDC,WMON],wallet,BigInt(deadline)]});
  expect(()=>validateSwapShape({to:p.router,data:wrongPath,value:0n},p,intent,amount,min,deadline,1000)).toThrow(/path/);
  expect(()=>validateSwapShape({to:WMON,data,value:0n},p,intent,amount,min,deadline,1000)).toThrow(/target/);
  expect(()=>validateSwapShape({to:p.router,data,value:1n},p,intent,amount,min,deadline,1000)).toThrow(/target/);
  const unsupported=encodeFunctionData({abi:ROUTER_ABI,functionName:'getAmountsOut',args:[amount,[WMON,USDC]]});
  expect(()=>validateSwapShape({to:p.router,data:unsupported,value:0n},p,intent,amount,min,deadline,1000)).toThrow(/function/);
});

import { policyOwnerUid } from '../src/policy.ts';
it('only the testnet profile, and only when asked, accepts a policy owned by the signer user', () => {
    expect(policyOwnerUid('testnet', { TRADGENTS_TESTNET_USER_POLICY: '1' }, 1000)).toBe(1000);
    expect(policyOwnerUid('testnet', {}, 1000)).toBe(0);
    expect(policyOwnerUid('mainnet', { TRADGENTS_TESTNET_USER_POLICY: '1' }, 1000)).toBe(0);
});
