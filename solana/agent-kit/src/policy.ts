import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const DEVNET_USDC = 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k';
export const WSOL = 'So11111111111111111111111111111111111111112';
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const STABLE_MINTS = new Set([USDC, USDT, DEVNET_USDC]);

const mint = z.string().min(32).max(44);
export const policySchema = z.object({
  /** devnet uses Orca's test pool and test money; mainnet-beta uses Jupiter and real money. */
  network: z.enum(['mainnet-beta', 'devnet']),
  rpcUrl: z.string().url(),
  keypairPath: z.string().min(1),
  stateDir: z.string().min(1),
  socketPath: z.string().min(1),
  /** Octal file mode of the socket, as a string. 600 keeps it to the signer's own user. */
  socketMode: z.string().regex(/^[0-7]{3}$/).default('600'),
  apiUrl: z.string().url(),
  jupiterUrl: z.string().url().default('https://lite-api.jup.ag/swap/v1'),
  priceUrl: z.string().url().default('https://lite-api.jup.ag/price/v3'),
  registryProgram: z.string().min(32).max(44).optional(),
  maxTradeUsd: z.number().positive().max(1_000_000),
  maxDailyUsd: z.number().positive().max(10_000_000),
  maxSlippageBps: z.number().int().min(1).max(500).default(100),
  maxPriceImpactBps: z.number().int().min(0).max(500).default(100),
  /** How far the quote may sit below the oracle value of the input, on top of slippage and impact. */
  oracleToleranceBps: z.number().int().min(0).max(500).default(150),
  maxPriorityLamports: z.number().int().min(0).max(50_000_000).default(500_000),
  maxTipLamports: z.number().int().min(0).max(50_000_000).default(0),
  solReserveLamports: z.number().int().min(0).default(20_000_000),
  minLiquidityUsd: z.number().nonnegative().default(25_000),
  maxBondSol: z.number().nonnegative().max(100).default(0.5),
  /** Every swap, however small, pays network fees, so the number of trades per rolling day is capped too. */
  maxTradesPerDay: z.number().int().positive().max(10_000).default(20),
  /** If set, every program the simulation shows being invoked must be on this list (plus the built-in infrastructure and Jupiter). */
  routePrograms: z.array(z.string().min(32).max(44)).optional(),
  allowedMints: z.record(mint, z.string().min(1).max(12)).optional(),
}).strict().refine(p => p.maxTradeUsd <= p.maxDailyUsd, 'maxTradeUsd must not exceed maxDailyUsd')
  // the default token list depends on the network
  .transform(p => ({ ...p, allowedMints: p.allowedMints ?? (p.network === 'devnet' ? { [WSOL]: 'SOL', [DEVNET_USDC]: 'USDC' } : { [WSOL]: 'SOL', [USDC]: 'USDC', [USDT]: 'USDT' }) }));
export type Policy = z.infer<typeof policySchema>;

/**
 * Loads the owner's policy and refuses to run if the file or the key could be tampered with by someone else.
 * A rule the agent can edit is not a rule.
 */
export function loadPolicy(file: string, uid: number | undefined = process.getuid?.()): Policy {
  const st = fs.statSync(file);
  if (uid !== undefined && st.uid !== uid) throw new Error(`Policy ${file} must be owned by the user running the signer`);
  if (st.mode & 0o022) throw new Error(`Policy ${file} is writable by group or others (mode ${(st.mode & 0o777).toString(8)}); chmod 600 it`);
  const dir = fs.statSync(path.dirname(path.resolve(file)));
  if (uid !== undefined && dir.uid !== uid) throw new Error(`The folder holding ${file} must be owned by the user running the signer`);
  if (dir.mode & 0o022) throw new Error(`The folder holding ${file} is writable by group or others; someone could swap the policy file`);
  const p = policySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  const key = fs.statSync(p.keypairPath);
  if (uid !== undefined && key.uid !== uid) throw new Error(`Key ${p.keypairPath} must be owned by the user running the signer`);
  if (key.mode & 0o077) throw new Error(`Key ${p.keypairPath} must be readable only by its owner (chmod 600)`);
  return p;
}
export const pausePath = (p: Policy) => path.join(p.stateDir, 'PAUSE');
