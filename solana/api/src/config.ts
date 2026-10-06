import { z } from 'zod';

export const STABLES: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': 'PYUSD',
  BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k: 'devUSDC', // Orca devnet
};
export const WSOL = 'So11111111111111111111111111111111111111112';
/** Programs whose transactions we treat as trades when the wallet swaps one asset for another. */
export const SWAP_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca Whirlpools
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', // Raydium CLMM
  'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', // Raydium CPMM
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', // Meteora pools
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', // Pump.fun AMM
  ...(process.env.EXTRA_SWAP_PROGRAMS ?? '').split(',').map(s => s.trim()).filter(Boolean),
]);

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** Programs that move or account for assets without being trades. A transaction that invokes anything outside INFRA + SWAP is `unsupported`. */
export const INFRA_PROGRAMS = new Set([
  '11111111111111111111111111111111', TOKEN_PROGRAM, TOKEN_2022_PROGRAM,
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'ComputeBudget111111111111111111111111111111',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);
/** Jito tip accounts (checked live on mainnet on 2026-10-06). A tip is a cost, not a trade leg. */
export const TIP_ACCOUNTS = new Set([
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5', 'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe', 'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49', 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh', 'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL', '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
]);
/** Rent for a standard 165-byte token account, in lamports. */
export const TOKEN_ACCOUNT_RENT = 2_039_280n;
/** Which protocol page a swap belongs to, by the most specific program it invoked. Jupiter is only the router. */
export const PROTOCOL_OF: [string, 'orca' | 'raydium' | 'meteora' | 'pumpfun' | 'jupiter'][] = [
  ['whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'orca'],
  ['675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', 'raydium'], ['CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'raydium'], ['CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C', 'raydium'],
  ['LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'meteora'], ['Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB', 'meteora'],
  ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pumpfun'], ['pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'pumpfun'],
  ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'jupiter'],
];

const schema = z.object({
  SOLANA_CLUSTER: z.enum(['mainnet-beta', 'devnet']).default('mainnet-beta'),
  RPC_URL: z.string().url().optional(),
  PROGRAM_ID: z.string().min(32).max(44).optional(),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_DIRECT: z.string().min(1).optional(),
  CORS_ORIGINS: z.string().default(''),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  JUPITER_API_KEY: z.string().optional(),
  JUPITER_PRICE_URL: z.string().url().optional(),
  MIN_LIQUIDITY_USD: z.coerce.number().nonnegative().default(25_000),
  POLL_SECONDS: z.coerce.number().positive().default(10),
  INDEXER: z.enum(['on', 'off']).default('on'),
});
export type Config = z.infer<typeof schema> & { rpcUrl: string; programId: string };
const DEFAULT_PROGRAM = '73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA'; // devnet deployment; set PROGRAM_ID for mainnet

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  const mainnet = c.SOLANA_CLUSTER === 'mainnet-beta';
  if (mainnet && !c.RPC_URL) throw new Error('RPC_URL is required on mainnet-beta: the public endpoint is not meant for this load');
  if (mainnet && !c.PROGRAM_ID) throw new Error('PROGRAM_ID is required on mainnet-beta (the registry deployment you control)');
  return { ...c, rpcUrl: c.RPC_URL ?? 'https://api.devnet.solana.com', programId: c.PROGRAM_ID ?? DEFAULT_PROGRAM };
}
