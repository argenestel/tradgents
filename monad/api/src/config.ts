import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { USDC,WMON } from './protocols.ts';

const address = z.string().refine(isAddress,'must be a valid EVM address').transform(v => v as Address);
const envSchema = z.object({
  MONAD_CHAIN_ID: z.coerce.number().int().positive().default(143),
  MONAD_RPC_URL: z.string().url(),
  REGISTRY_ADDRESS: address,
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_DIRECT: z.string().min(1),
  CORS_ORIGINS: z.string().default(''),
  API_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace','silent']).default('info'),
  SENTRY_DSN: z.string().url().optional(),
  INDEXER_POLL_MS: z.coerce.number().int().min(300).default(1000),
  INDEXER_MAX_LAG_BLOCKS: z.coerce.number().int().positive().default(1200),
  PRICE_STALE_MS: z.coerce.number().int().positive().default(3_600_000),
  MONAD_PRICE_STALE_MS: z.coerce.number().int().positive().optional(),
  USDC_PRICE_STALE_MS: z.coerce.number().int().positive().optional(),
  MIN_LIQUIDITY_USD: z.coerce.number().positive().finite().default(10_000),
  MONAD_PRICE_FEED_ID: z.string().regex(/^0x[0-9a-fA-F]{64}$/).default('0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1'),
  USDC_PRICE_FEED_ID: z.string().regex(/^0x[0-9a-fA-F]{64}$/).default('0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'),
  MONAD_TRACKED_TOKENS: z.string().max(12_000).default(''),
});

export interface Config {
  chainId: number;
  rpcUrl: string;
  registryAddress: Address;
  databaseUrl: string;
  databaseUrlDirect: string;
  corsOrigins: string[];
  apiUrl?: string;
  port: number;
  host: string;
  logLevel: 'fatal'|'error'|'warn'|'info'|'debug'|'trace'|'silent';
  sentryDsn?: string;
  indexerPollMs: number;
  indexerMaxLagBlocks: number;
  priceStaleMs: number;
  monPriceStaleMs: number;
  usdcPriceStaleMs: number;
  minLiquidityUsd: number;
  monadPriceFeedId: `0x${string}`;
  usdcPriceFeedId: `0x${string}`;
  trackedTokens: {address:Address;decimals:number}[];
}

export function parseConfig(env: NodeJS.ProcessEnv | Record<string,string|undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const v = parsed.data;
  const corsOrigins = v.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS must be a comma-separated list of origins'); }
    if (url.origin !== origin || !['http:','https:'].includes(url.protocol)) throw new Error('CORS_ORIGINS entries must be HTTP(S) origins');
  }
  if (v.REGISTRY_ADDRESS === '0x0000000000000000000000000000000000000000') throw new Error('REGISTRY_ADDRESS must be a deployed registry address');
  const trackedTokens=v.MONAD_TRACKED_TOKENS.split(',').map(s=>s.trim()).filter(Boolean).map(entry=>{
    const match=/^(0x[0-9a-fA-F]{40}):(\d{1,2})$/.exec(entry);
    if(!match||!isAddress(match[1]))throw new Error('MONAD_TRACKED_TOKENS entries must be address:decimals');
    const decimals=Number(match[2]);if(decimals>36)throw new Error('MONAD_TRACKED_TOKENS decimals must be 0..36');
    return {address:match[1] as Address,decimals};
  });
  if(trackedTokens.length>100)throw new Error('MONAD_TRACKED_TOKENS may contain at most 100 addresses');
  if(new Set(trackedTokens.map(t=>t.address.toLowerCase())).size!==trackedTokens.length)throw new Error('MONAD_TRACKED_TOKENS contains duplicate addresses');
  if(trackedTokens.some(t=>[WMON,USDC].some(a=>a.toLowerCase()===t.address.toLowerCase())))throw new Error('MONAD_TRACKED_TOKENS must not repeat canonical WMON or USDC');
  return {
    chainId:v.MONAD_CHAIN_ID, rpcUrl:v.MONAD_RPC_URL, registryAddress:v.REGISTRY_ADDRESS,
    databaseUrl:v.DATABASE_URL, databaseUrlDirect:v.DATABASE_URL_DIRECT, corsOrigins,
    ...(v.API_URL ? {apiUrl:v.API_URL} : {}), port:v.PORT, host:v.HOST, logLevel:v.LOG_LEVEL,
    ...(v.SENTRY_DSN ? {sentryDsn:v.SENTRY_DSN} : {}), indexerPollMs:v.INDEXER_POLL_MS,
    indexerMaxLagBlocks:v.INDEXER_MAX_LAG_BLOCKS, priceStaleMs:v.PRICE_STALE_MS,
    monPriceStaleMs:v.MONAD_PRICE_STALE_MS??v.PRICE_STALE_MS,usdcPriceStaleMs:v.USDC_PRICE_STALE_MS??v.PRICE_STALE_MS,minLiquidityUsd:v.MIN_LIQUIDITY_USD,
    monadPriceFeedId:v.MONAD_PRICE_FEED_ID as `0x${string}`, usdcPriceFeedId:v.USDC_PRICE_FEED_ID as `0x${string}`,
    trackedTokens,
  };
}
export function loadConfig(): Config { return parseConfig(process.env); }
