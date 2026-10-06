import { lstatSync,readFileSync } from 'node:fs';
import { z } from 'zod';
import { isAddress,type Address } from 'viem';
import { USDC,UNISWAP_V2_FACTORY,UNISWAP_V2_ROUTER,WMON } from './venue.ts';

const addr=z.string().refine(isAddress,'invalid EVM address').transform(x=>x as Address);
export const POLICY_SCHEMA=z.object({
  version:z.literal(1),chainId:z.literal(143),registryAddress:addr,
  venue:z.literal('uniswap-v2'),router:addr.refine(a=>a.toLowerCase()===UNISWAP_V2_ROUTER.toLowerCase(),'router is not the pinned Monad Uniswap V2 Router02'),
  factory:addr.refine(a=>a.toLowerCase()===UNISWAP_V2_FACTORY.toLowerCase(),'factory is not the pinned Monad Uniswap V2 factory'),
  walletAddress:addr,ownerAddress:addr,
  tokens:z.array(z.object({symbol:z.enum(['WMON','USDC']),address:addr,decimals:z.number().int().min(0).max(36)}).strict()).min(2).max(2),
  perTradeLimitUsd:z.number().positive().finite(),perDayLimitUsd:z.number().positive().finite(),
  maxSlippageBps:z.number().int().min(1).max(100),maxGasLimit:z.string().regex(/^\d+$/),maxGasPriceWei:z.string().regex(/^\d+$/),
  // Pyth push feeds publish on an approximately hourly heartbeat; permit per-feed overrides.
  maxPriceAgeSeconds:z.object({WMON:z.number().int().min(1).max(7200).default(3600),USDC:z.number().int().min(1).max(7200).default(3600)}).strict().default({WMON:3600,USDC:3600}),
  minPoolLiquidityUsd:z.number().positive().finite().default(10_000),
}).strict().superRefine((p,ctx)=>{
  const w=p.tokens.find(t=>t.symbol==='WMON'),u=p.tokens.find(t=>t.symbol==='USDC');
  if(p.tokens.length!==2||!w||!u||w.address.toLowerCase()!==WMON.toLowerCase()||w.decimals!==18||u.address.toLowerCase()!==USDC.toLowerCase()||u.decimals!==6)ctx.addIssue({code:'custom',message:'token set must be exactly canonical WMON (18) and USDC (6)'});
  if(BigInt(p.maxGasLimit)<=0n||BigInt(p.maxGasPriceWei)<=0n)ctx.addIssue({code:'custom',message:'gas policy limits must be positive'});
});
export type SignerPolicy=z.infer<typeof POLICY_SCHEMA>;
export const DEFAULT_POLICY:SignerPolicy={version:1,chainId:143,registryAddress:'0x0000000000000000000000000000000000000000',venue:'uniswap-v2',router:UNISWAP_V2_ROUTER,factory:UNISWAP_V2_FACTORY,walletAddress:'0x0000000000000000000000000000000000000001',ownerAddress:'0x0000000000000000000000000000000000000000',tokens:[{symbol:'WMON',address:WMON,decimals:18},{symbol:'USDC',address:USDC,decimals:6}],perTradeLimitUsd:50,perDayLimitUsd:150,maxSlippageBps:100,maxGasLimit:'500000',maxGasPriceWei:'100000000000',maxPriceAgeSeconds:{WMON:3600,USDC:3600},minPoolLiquidityUsd:10_000};

export function parsePolicy(input:unknown):SignerPolicy {
  const parsed=POLICY_SCHEMA.safeParse(input);if(!parsed.success)throw new Error(`invalid signer policy: ${parsed.error.issues.map(i=>i.message).join('; ')}`);return parsed.data;
}
export function assertRootOwnedPolicyFile(path:string,ownerUid=0):void {
  const st=lstatSync(path);if(st.isSymbolicLink()||!st.isFile())throw new Error('policy must be a regular file');
  if(st.uid!==ownerUid)throw new Error(`policy file must be owned by uid ${ownerUid}`);
  if((st.mode&0o137)!==0)throw new Error('policy file permissions must be no looser than 0640 and must not be world-readable');
}
export function loadPolicy(path:string):SignerPolicy {assertRootOwnedPolicyFile(path,0);return parsePolicy(JSON.parse(readFileSync(path,'utf8')));}
