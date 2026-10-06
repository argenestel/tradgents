import { decodeFunctionData,type Address,type Hex } from 'viem';
import { z } from 'zod';
import type { SignerPolicy } from './policy.ts';
import { ERC20_ABI,ROUTER_ABI } from './venue.ts';

export const SwapIntentSchema=z.object({type:z.literal('swap'),tokenIn:z.enum(['WMON','USDC']),tokenOut:z.enum(['WMON','USDC']),amount:z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).max(80),maxSlippageBps:z.number().int().min(1).max(100)}).strict().refine(v=>v.tokenIn!==v.tokenOut,'input and output token must differ');
export type SwapIntent=z.infer<typeof SwapIntentSchema>;
export function validateIntent(input:unknown,policy:SignerPolicy):SwapIntent {
  const p=SwapIntentSchema.safeParse(input);if(!p.success)throw new Error(`invalid intent: ${p.error.issues.map(i=>i.message).join('; ')}`);
  if(p.data.maxSlippageBps>policy.maxSlippageBps)throw new Error('intent slippage exceeds policy limit');
  if(Number(p.data.amount)<=0)throw new Error('amount must be positive');
  const decimals=policy.tokens.find(t=>t.symbol===p.data.tokenIn)!.decimals;
  const fractional=p.data.amount.split('.')[1]?.length??0;if(fractional>decimals)throw new Error('amount has too many decimal places');
  return p.data;
}
export interface TxShape {to:Address;data:Hex;value:bigint}
function same(a:string,b:string):boolean{return a.toLowerCase()===b.toLowerCase();}
export function validateApprovalShape(tx:TxShape,policy:SignerPolicy,tokenIn:string,exactAmount:bigint):void {
  const token=policy.tokens.find(t=>t.symbol===tokenIn);if(!token)throw new Error('approval token is not allowlisted');
  if(!same(tx.to,token.address)||tx.value!==0n)throw new Error('approval target or native value is forbidden');
  let decoded;try{decoded=decodeFunctionData({abi:ERC20_ABI,data:tx.data});}catch{throw new Error('approval calldata is invalid');}
  if(decoded.functionName!=='approve')throw new Error('only exact ERC-20 approve is permitted');
  const [spender,amount]=decoded.args;
  if(!same(spender,policy.router))throw new Error('approval spender must be the pinned router');
  if(amount!==exactAmount||amount===((1n<<256n)-1n))throw new Error('approval must be for the exact trade amount; unlimited approval is forbidden');
}
export function validateSwapShape(tx:TxShape,policy:SignerPolicy,intent:SwapIntent,amountIn:bigint,minOut:bigint,deadline:number,nowSeconds:number):void {
  if(!same(tx.to,policy.router)||tx.value!==0n)throw new Error('swap target or native value is forbidden');
  let decoded;try{decoded=decodeFunctionData({abi:ROUTER_ABI,data:tx.data});}catch{throw new Error('swap calldata is invalid');}
  if(decoded.functionName!=='swapExactTokensForTokens')throw new Error('unsupported router function');
  const [actualIn,actualMin,path,recipient,actualDeadline]=decoded.args;
  const input=policy.tokens.find(t=>t.symbol===intent.tokenIn)!,output=policy.tokens.find(t=>t.symbol===intent.tokenOut)!;
  if(actualIn!==amountIn||actualMin!==minOut||path.length!==2||!same(path[0],input.address)||!same(path[1],output.address))throw new Error('swap amounts/path do not match the checked intent');
  if(!same(recipient,policy.walletAddress))throw new Error("swap recipient must be the signer's agent wallet");
  if(actualDeadline!==BigInt(deadline)||actualDeadline<=BigInt(nowSeconds)||actualDeadline>BigInt(nowSeconds+300))throw new Error('swap deadline is invalid or too far in the future');
}

export function assertTradeLimits(policy:SignerPolicy,usageTodayUsd:number,tradeUsd:number):void {
  if(!Number.isFinite(tradeUsd)||tradeUsd<=0)throw new Error('trade notional must be positive and finite');
  if(tradeUsd>policy.perTradeLimitUsd)throw new Error('per-trade USD limit exceeded');
  if(usageTodayUsd+tradeUsd>policy.perDayLimitUsd)throw new Error('per-day USD limit exceeded');
}
