import { z } from 'zod';
import { isAddress, type Address } from 'viem';
import { getNetworkProfile, type MonadNetwork, type NetworkProfile } from './profiles.ts';

const address = z.string().refine(isAddress, 'must be a valid EVM address').transform(v => v as Address);
const envSchema = z.object({
  MONAD_NETWORK: z.enum(['mainnet', 'testnet']).default('mainnet'),
  MONAD_CHAIN_ID: z.coerce.number().int().positive().optional(),
  MONAD_RPC_URL: z.string().url().optional(),
  REGISTRY_ADDRESS: address,
  TESTNET_V2_ROUTER: z.string().optional(),
  TESTNET_V2_FACTORY: z.string().optional(),
  TESTNET_USDC: z.string().optional(),
  TESTNET_WMON: z.string().optional(),
  TESTNET_FIXED_PRICES: z.enum(['true', 'false']).default('false'),
  TESTNET_MON_PRICE_USD: z.coerce.number().positive().finite().optional(),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_DIRECT: z.string().min(1),
  CORS_ORIGINS: z.string().default(''),
  API_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SENTRY_DSN: z.string().url().optional(),
  INDEXER_POLL_MS: z.coerce.number().int().min(300).default(1000),
  INDEXER_MAX_LAG_BLOCKS: z.coerce.number().int().positive().default(1200),
  /** The block the registry was deployed in. The registry scan starts here; without it a fresh database starts at the chain head and misses earlier registrations. */
  REGISTRY_START_BLOCK: z.coerce.number().int().min(0).optional(),
  /** Widest eth_getLogs block range the RPC accepts. Monad's public testnet RPC allows 100. */
  LOG_RANGE_BLOCKS: z.coerce.number().int().min(1).max(10_000).default(100),
  PRICE_STALE_MS: z.coerce.number().int().positive().default(3_600_000),
  MONAD_PRICE_STALE_MS: z.coerce.number().int().positive().optional(),
  USDC_PRICE_STALE_MS: z.coerce.number().int().positive().optional(),
  MIN_LIQUIDITY_USD: z.coerce.number().positive().finite().default(10_000),
  MONAD_TRACKED_TOKENS: z.string().max(12_000).default(''),
});

export interface Config {
  network: MonadNetwork;
  profile: NetworkProfile;
  chainId: number;
  rpcUrl: string;
  registryAddress: Address;
  databaseUrl: string;
  databaseUrlDirect: string;
  corsOrigins: string[];
  apiUrl?: string;
  port: number;
  host: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  sentryDsn?: string;
  indexerPollMs: number;
  indexerMaxLagBlocks: number;
  registryStartBlock?: number;
  logRangeBlocks: number;
  priceStaleMs: number;
  monPriceStaleMs: number;
  usdcPriceStaleMs: number;
  minLiquidityUsd: number;
  monadPriceFeedId: `0x${string}`;
  usdcPriceFeedId: `0x${string}`;
  testnetFixedPrices: boolean;
  testnetMonPriceUsd?: number;
  trackedTokens: { address: Address; decimals: number }[];
}

export function parseConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const v = parsed.data;
  const profile = getNetworkProfile(v.MONAD_NETWORK, env);
  if (v.MONAD_CHAIN_ID !== undefined && v.MONAD_CHAIN_ID !== profile.chainId)
    throw new Error(`MONAD_CHAIN_ID ${v.MONAD_CHAIN_ID} does not match MONAD_NETWORK=${v.MONAD_NETWORK} profile chain ${profile.chainId}`);
  if (v.REGISTRY_ADDRESS === '0x0000000000000000000000000000000000000000') throw new Error('REGISTRY_ADDRESS must be a deployed registry address');
  if (v.TESTNET_FIXED_PRICES === 'true' && v.MONAD_NETWORK !== 'testnet') throw new Error('TESTNET_FIXED_PRICES is only allowed with MONAD_NETWORK=testnet');
  if (v.TESTNET_FIXED_PRICES === 'true' && v.TESTNET_MON_PRICE_USD === undefined) throw new Error('TESTNET_FIXED_PRICES requires TESTNET_MON_PRICE_USD');
  const corsOrigins = v.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error('CORS_ORIGINS must be a comma-separated list of origins'); }
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('CORS_ORIGINS entries must be HTTP(S) origins');
  }
  const trackedTokens = v.MONAD_TRACKED_TOKENS.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const match = /^(0x[0-9a-fA-F]{40}):(\d{1,2})$/.exec(entry);
    if (!match || !isAddress(match[1])) throw new Error('MONAD_TRACKED_TOKENS entries must be address:decimals');
    const decimals = Number(match[2]); if (decimals > 36) throw new Error('MONAD_TRACKED_TOKENS decimals must be 0..36');
    return { address: match[1] as Address, decimals };
  });
  if (trackedTokens.length > 100) throw new Error('MONAD_TRACKED_TOKENS may contain at most 100 addresses');
  if (new Set(trackedTokens.map(t => t.address.toLowerCase())).size !== trackedTokens.length) throw new Error('MONAD_TRACKED_TOKENS contains duplicate addresses');
  if (trackedTokens.some(t => [profile.wmon, profile.usdc.address].some(a => a.toLowerCase() === t.address.toLowerCase())))
    throw new Error('MONAD_TRACKED_TOKENS must not repeat canonical WMON or USDC');
  return {
    network: v.MONAD_NETWORK, profile, chainId: profile.chainId, rpcUrl: v.MONAD_RPC_URL ?? profile.defaultRpcUrl,
    registryAddress: v.REGISTRY_ADDRESS, databaseUrl: v.DATABASE_URL, databaseUrlDirect: v.DATABASE_URL_DIRECT, corsOrigins,
    ...(v.API_URL ? { apiUrl: v.API_URL } : {}), port: v.PORT, host: v.HOST, logLevel: v.LOG_LEVEL,
    ...(v.SENTRY_DSN ? { sentryDsn: v.SENTRY_DSN } : {}), indexerPollMs: v.INDEXER_POLL_MS,
    indexerMaxLagBlocks: v.INDEXER_MAX_LAG_BLOCKS, ...(v.REGISTRY_START_BLOCK !== undefined ? { registryStartBlock: v.REGISTRY_START_BLOCK } : {}), logRangeBlocks: v.LOG_RANGE_BLOCKS, priceStaleMs: v.PRICE_STALE_MS,
    monPriceStaleMs: v.MONAD_PRICE_STALE_MS ?? v.PRICE_STALE_MS,
    usdcPriceStaleMs: v.USDC_PRICE_STALE_MS ?? v.PRICE_STALE_MS, minLiquidityUsd: v.MIN_LIQUIDITY_USD,
    monadPriceFeedId: profile.feeds.mon, usdcPriceFeedId: profile.feeds.usdc,
    testnetFixedPrices: v.TESTNET_FIXED_PRICES === 'true',
    ...(v.TESTNET_MON_PRICE_USD === undefined ? {} : { testnetMonPriceUsd: v.TESTNET_MON_PRICE_USD }),
    trackedTokens,
  };
}
export function loadConfig(): Config { return parseConfig(process.env); }
