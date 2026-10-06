import { type Address, type PublicClient, formatUnits } from 'viem';
import type { Config } from './config.ts';
import { readPythPrice } from './chain.ts';
import { TOKEN_CATALOG, USDC, WMON } from './protocols.ts';
import type { Opening } from './store.ts';

const BALANCE_ABI=[{type:'function',name:'balanceOf',stateMutability:'view',inputs:[{name:'account',type:'address'}],outputs:[{type:'uint256'}]}] as const;
export interface BalanceSnapshot { blockNumber:number;blockHash:string;tsMs:number;balances:Record<string,string>;tokenDecimals:Record<string,number> }
export async function readWalletBalances(client:PublicClient,wallet:Address,blockNumber:bigint,trackedTokens:Config['trackedTokens']=[]):Promise<Record<string,string>> {
  const [native,wmon,usdc,...extras]=await Promise.all([
    client.getBalance({address:wallet,blockNumber}),
    client.readContract({address:WMON,abi:BALANCE_ABI,functionName:'balanceOf',args:[wallet],blockNumber}),
    client.readContract({address:USDC,abi:BALANCE_ABI,functionName:'balanceOf',args:[wallet],blockNumber}),
    ...trackedTokens.map(t=>client.readContract({address:t.address,abi:BALANCE_ABI,functionName:'balanceOf',args:[wallet],blockNumber})),
  ]);
  return {MON:native.toString(),WMON:wmon.toString(),USDC:usdc.toString(),...Object.fromEntries(trackedTokens.map((t,i)=>[t.address.toLowerCase(),extras[i].toString()]))};
}
export async function snapshotWallet(client:PublicClient,wallet:Address,cfg:Config,now=Date.now()):Promise<Opening> {
  const block=await client.getBlock({blockTag:'finalized'});
  const balances=await readWalletBalances(client,wallet,block.number,cfg.trackedTokens);
  const [mon,usdc]=await Promise.all([
    readPythPrice(client,cfg.monadPriceFeedId,now,cfg.priceStaleMs,block.number),
    readPythPrice(client,cfg.usdcPriceFeedId,now,cfg.priceStaleMs,block.number),
  ]);
  const prices={MON:mon.usd,WMON:mon.usd,USDC:usdc.usd};
  return {blockNumber:Number(block.number),blockHash:block.hash??'0x',tsMs:Number(block.timestamp)*1000,balances,tokenDecimals:Object.fromEntries(cfg.trackedTokens.map(t=>[t.address.toLowerCase(),t.decimals])),prices,priceQuality:{MON:mon.quality,WMON:mon.quality,USDC:usdc.quality}};
}
export function snapshotEquity(balances:Record<string,string>,prices:Record<string,number>,tokenDecimals:Record<string,number>={}):number {
  let total=0;
  for(const [token,raw] of Object.entries(balances)){
    const p=prices[token];if(p===undefined)continue;
    const decimals=tokenDecimals[token]??(token==='USDC'?TOKEN_CATALOG.USDC.decimals:18);
    total+=Number(formatUnits(BigInt(raw),decimals))*p;
  }
  return total;
}
