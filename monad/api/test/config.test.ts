import { expect, it } from 'vitest';
import { parseConfig } from '../src/config.ts';
const env=(extra:Record<string,string>={})=>({MONAD_RPC_URL:'https://rpc.example',REGISTRY_ADDRESS:'0x0000000000000000000000000000000000000001',DATABASE_URL:'postgres://app:secret@localhost/db',DATABASE_URL_DIRECT:'postgres://app:secret@localhost/db',...extra});
const testnet=(extra:Record<string,string>={})=>env({MONAD_NETWORK:'testnet',TESTNET_V2_ROUTER:'0x0000000000000000000000000000000000000011',TESTNET_V2_FACTORY:'0x0000000000000000000000000000000000000012',TESTNET_USDC:'0x0000000000000000000000000000000000000013',...extra});
it('defaults to the pinned mainnet profile and profile-owned RPC/feed metadata',()=>{
  const cfg=parseConfig({REGISTRY_ADDRESS:'0x0000000000000000000000000000000000000001',DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:'});
  expect(cfg.network).toBe('mainnet');expect(cfg.chainId).toBe(143);expect(cfg.rpcUrl).toBe('https://rpc.monad.xyz');
  expect(cfg.profile.router).toBe('0x4b2ab38dbf28d31d467aa8993f6c2585981d6804');expect(cfg.profile.usdc.decimals).toBe(6);
  expect(cfg.monadPriceFeedId).toBe(cfg.profile.feeds.mon);expect(cfg.usdcPriceFeedId).toBe(cfg.profile.feeds.usdc);
});
it('selects the full Monad testnet profile and requires its deployed DEX addresses',()=>{
  const cfg=parseConfig(testnet({MONAD_RPC_URL:'https://testnet-rpc.monad.xyz'}));
  expect(cfg.network).toBe('testnet');expect(cfg.chainId).toBe(10143);expect(cfg.rpcUrl).toBe('https://testnet-rpc.monad.xyz');
  expect(cfg.profile.wmon).toBe('0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541');expect(cfg.profile.usdc.address).toBe('0x0000000000000000000000000000000000000013');
  expect(cfg.profile.router).toBe('0x0000000000000000000000000000000000000011');
  expect(()=>parseConfig(env({MONAD_CHAIN_ID:'10143'}))).toThrow(/does not match/);
  expect(()=>parseConfig({MONAD_NETWORK:'testnet',TESTNET_USDC:'0x0000000000000000000000000000000000000013',REGISTRY_ADDRESS:'0x0000000000000000000000000000000000000001',DATABASE_URL:'memory:',DATABASE_URL_DIRECT:'memory:'})).toThrow(/TESTNET_V2_ROUTER/);
  expect(()=>parseConfig(testnet({TESTNET_USDC:'bad'}))).toThrow(/TESTNET_USDC/);
});
it('keeps per-feed Pyth freshness and enforces testnet-only fixed-price configuration',()=>{
  const defaults=parseConfig(env());expect(defaults.monPriceStaleMs).toBe(3_600_000);expect(defaults.usdcPriceStaleMs).toBe(3_600_000);
  const custom=parseConfig(env({MONAD_PRICE_STALE_MS:'7200000',USDC_PRICE_STALE_MS:'1800000'}));expect(custom.monPriceStaleMs).toBe(7_200_000);expect(custom.usdcPriceStaleMs).toBe(1_800_000);
  expect(parseConfig(testnet({TESTNET_FIXED_PRICES:'true',TESTNET_MON_PRICE_USD:'0.25'})).testnetFixedPrices).toBe(true);
  expect(()=>parseConfig(env({TESTNET_FIXED_PRICES:'true',TESTNET_MON_PRICE_USD:'1'}))).toThrow(/only allowed/);
  expect(()=>parseConfig(testnet({TESTNET_FIXED_PRICES:'true'}))).toThrow(/requires TESTNET_MON_PRICE_USD/);
});
it('validates missing settings, tracked tokens and invalid origins',()=>{
  expect(()=>parseConfig({})).toThrow(/Invalid configuration/);
  expect(()=>parseConfig(env({REGISTRY_ADDRESS:'not-an-address'}))).toThrow(/Invalid configuration/);
  expect(()=>parseConfig(env({CORS_ORIGINS:'https://app.example/path'}))).toThrow(/origins/);
  expect(parseConfig(env({MONAD_TRACKED_TOKENS:'0x0000000000000000000000000000000000000002:6'})).trackedTokens).toEqual([{address:'0x0000000000000000000000000000000000000002',decimals:6}]);
  expect(()=>parseConfig(env({MONAD_TRACKED_TOKENS:'0x0000000000000000000000000000000000000002'}))).toThrow(/address:decimals/);
});

it('reads the registry start block', () => {
  expect(parseConfig(env({ REGISTRY_START_BLOCK: '68766451' })).registryStartBlock).toBe(68766451);
  expect(parseConfig(env()).registryStartBlock).toBeUndefined();
});
