import { createPublicClient, defineChain, http, type PublicClient } from 'viem';
import type { Config } from './config.ts';
import { PYTH_PRICE_FEED,TOKEN_CATALOG } from './protocols.ts';

// Mainnet chain ID 143 and RPC URL are from the official network page:
// https://docs.monad.xyz/developer-essentials/network-information
export const monadMainnet=defineChain({
  id:143,name:'Monad',nativeCurrency:{name:'Monad',symbol:'MON',decimals:18},
  rpcUrls:{default:{http:['https://rpc.monad.xyz']}},blockExplorers:{default:{name:'MonadVision',url:'https://monadvision.com'}},
});
export const createMonadClient=(cfg:Config):PublicClient=>createPublicClient({chain:cfg.chainId===143?monadMainnet:{...monadMainnet,id:cfg.chainId},transport:http(cfg.rpcUrl,{timeout:15_000,retryCount:3})});
export async function finalizedBlockNumber(client:PublicClient):Promise<bigint> { return (await client.getBlock({blockTag:'finalized'})).number; }
export async function safeBlockNumber(client:PublicClient):Promise<bigint> { return (await client.getBlock({blockTag:'safe'})).number; }
export async function verifyChainDeployment(client:PublicClient,cfg:Pick<Config,'chainId'|'registryAddress'>):Promise<void> {
  const chainId=await client.getChainId();
  if(chainId!==cfg.chainId)throw new Error(`RPC chain id ${chainId} does not match MONAD_CHAIN_ID ${cfg.chainId}`);
  const code=await client.getCode({address:cfg.registryAddress});
  if(!code||code==='0x')throw new Error(`REGISTRY_ADDRESS ${cfg.registryAddress} has no deployed bytecode on chain ${chainId}`);
}
const DECIMALS_ABI=[{type:'function',name:'decimals',stateMutability:'view',inputs:[],outputs:[{type:'uint8'}]}] as const;
export async function verifyUsdcDecimals(client:PublicClient,expected=6):Promise<void> {
  const chainId=await client.getChainId();if(chainId!==143)throw new Error(`USDC decimals must be verified on Monad chain 143, got ${chainId}`);
  const decimals=Number(await client.readContract({address:TOKEN_CATALOG.USDC.address,abi:DECIMALS_ABI,functionName:'decimals'}));
  if(decimals!==expected||decimals!==6)throw new Error(`on-chain Monad USDC decimals are ${decimals}; expected policy/config value 6`);
}

const PYTH_ABI=[{type:'function',name:'getPriceUnsafe',stateMutability:'view',inputs:[{name:'id',type:'bytes32'}],outputs:[{type:'tuple',components:[{name:'price',type:'int64'},{name:'conf',type:'uint64'},{name:'expo',type:'int32'},{name:'publishTime',type:'uint256'}]}]}] as const;
export interface OraclePrice { usd:number;tsMs:number;quality:'oracle'|'estimated';source:string;liquidityUsd?:number }
export async function readPythPrice(client:PublicClient,feedId:`0x${string}`,now=Date.now(),staleAfterMs=3_600_000,blockNumber?:bigint):Promise<OraclePrice> {
  const p=await client.readContract({address:PYTH_PRICE_FEED,abi:PYTH_ABI,functionName:'getPriceUnsafe',args:[feedId],...(blockNumber===undefined?{}:{blockNumber})});
  let usd=Number(p.price)*10**p.expo;const tsMs=Number(p.publishTime)*1000;
  if(!Number.isFinite(usd)||usd<=0||!Number.isFinite(tsMs))throw new Error(`invalid Pyth sample for ${feedId}`);
  const ageMs=now-tsMs;let quality:OraclePrice['quality']=ageMs>=-60_000&&ageMs<=staleAfterMs&&Number(p.conf)/Math.max(1,Number(p.price))<=0.01?'oracle':'estimated';
  if(feedId.toLowerCase()===TOKEN_CATALOG.USDC.feed.toLowerCase()){
    if(usd>=0.97&&usd<=1.03)usd=1;
    else quality='estimated';
  }
  return {usd,tsMs,quality,source:'pyth-monad-onchain'};
}
export { PYTH_PRICE_FEED };
