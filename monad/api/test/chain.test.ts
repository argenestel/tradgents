import { expect, it } from 'vitest';
import type { PublicClient } from 'viem';
import { readConfiguredPrice, verifyChainDeployment, verifyUsdcDecimals, verifyWmonMetadata } from '../src/chain.ts';
import { parseConfig } from '../src/config.ts';
import { getNetworkProfile, profilePinnedAddresses } from '../src/profiles.ts';

const mainProfile=getNetworkProfile('mainnet'),registry='0x0000000000000000000000000000000000000001' as const;
const mainConfig={chainId:143,registryAddress:registry,profile:mainProfile};
const testProfile=getNetworkProfile('testnet',{TESTNET_V2_ROUTER:'0x0000000000000000000000000000000000000011',TESTNET_V2_FACTORY:'0x0000000000000000000000000000000000000012',TESTNET_USDC:'0x0000000000000000000000000000000000000013'});
it('keeps mainnet USDC decimals verified on chain 143 and checks testnet stable metadata on chain 10143',async()=>{
  await expect(verifyUsdcDecimals({getChainId:async()=>143,readContract:async()=>6} as unknown as PublicClient)).resolves.toBeUndefined();
  await expect(verifyUsdcDecimals({getChainId:async()=>143,readContract:async()=>18} as unknown as PublicClient)).rejects.toThrow(/expected policy\/profile value 6/);
  await expect(verifyUsdcDecimals({getChainId:async()=>10143,readContract:async()=>6} as unknown as PublicClient)).rejects.toThrow(/chain 143/);
  await expect(verifyUsdcDecimals({getChainId:async()=>10143,readContract:async()=>6} as unknown as PublicClient,6,testProfile)).resolves.toBeUndefined();
  await expect(verifyUsdcDecimals({getChainId:async()=>10143,readContract:async()=>18} as unknown as PublicClient,6,testProfile)).rejects.toThrow(/expected policy\/profile value 6/);
  await expect(verifyWmonMetadata({readContract:async({functionName}: {functionName:string})=>functionName==='decimals'?18:'WMON'} as unknown as PublicClient,testProfile)).resolves.toBeUndefined();
});
it('labels fixed prices estimated and accepts them only on explicitly configured testnet',async()=>{
  const cfg=parseConfig({MONAD_NETWORK:'testnet',TESTNET_V2_ROUTER:'0x0000000000000000000000000000000000000011',TESTNET_V2_FACTORY:'0x0000000000000000000000000000000000000012',TESTNET_USDC:'0x0000000000000000000000000000000000000013',TESTNET_FIXED_PRICES:'true',TESTNET_MON_PRICE_USD:'0.20',REGISTRY_ADDRESS:registry,DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:'});
  const client={readContract:async()=>({price:27_619_07n,conf:0n,expo:-8,publishTime:0n})} as unknown as PublicClient;
  const mon=await readConfiguredPrice(client,cfg,'MON',10_000_000),usdc=await readConfiguredPrice(client,cfg,'USDC',10_000_000);
  expect(mon).toMatchObject({usd:0.2,quality:'estimated',source:'testnet-fixed-prices'});
  expect(usdc).toMatchObject({usd:1,quality:'estimated',source:'testnet-fixed-prices'});
  const main=parseConfig({REGISTRY_ADDRESS:registry,DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:'});
  await expect(readConfiguredPrice(client,main,'MON',10_000_000)).resolves.toMatchObject({quality:'estimated',source:'pyth-monad-onchain'});
});
it('fails closed on a wrong profile chain and verifies bytecode for every pinned address',async()=>{
  const mismatch={getChainId:async()=>10143,getCode:async()=> '0x6001'} as unknown as PublicClient;
  await expect(verifyChainDeployment(mismatch,mainConfig)).rejects.toThrow(/does not match/);
  const absent=registry;
  const empty={getChainId:async()=>143,getCode:async({address}:{address:string})=>address.toLowerCase()===absent?'0x':'0x6001'} as unknown as PublicClient;
  await expect(verifyChainDeployment(empty,mainConfig)).rejects.toThrow(/no deployed bytecode/);
  const seen:string[]=[],ok={getChainId:async()=>143,getCode:async({address}:{address:string})=>{seen.push(address.toLowerCase());return '0x6001';}} as unknown as PublicClient;
  await expect(verifyChainDeployment(ok,mainConfig)).resolves.toBeUndefined();
  expect(new Set(seen)).toEqual(new Set([registry.toLowerCase(),...profilePinnedAddresses(mainProfile).map(a=>a.toLowerCase())]));
  const wrongProfile={chainId:143,registryAddress:registry,profile:testProfile} as never;
  await expect(verifyChainDeployment(ok,wrongProfile)).rejects.toThrow(/does not match/);
});
