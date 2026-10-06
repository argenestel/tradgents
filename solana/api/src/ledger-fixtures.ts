import { TOKEN_PROGRAM } from './config';
import type { ChainTx, TokenBalance } from './ledger';

export const W = 'EET2cUX1nrFcQ12vBuyFsXfNACmSm1gs93jCsFiLvsSk';
const WALLET = W;
export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const WSOL = 'So11111111111111111111111111111111111111112';
export const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // an arbitrary unpriced-style token for tests (5 decimals)
export const WIF = 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm';
export const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const ORCA = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
export const SYSTEM = '11111111111111111111111111111111';
export const KAMINO = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
export const TIP = '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5';
const SOL = (n: number) => BigInt(Math.round(n * 1e9));

export interface Tok { mint: string; dec: number; pre?: number; post?: number; idx?: number }
export interface Step { wallet?: string; slot: number; time: number; pre: number; post: number; tokens?: Tok[]; programs?: string[]; fee?: number; payer?: boolean; err?: boolean; tip?: number }
/** Hand-built `getTransaction` result. SOL amounts are whole SOL, `post` is the balance after everything including fee and tip. */
export function tx(s: Step): ChainTx {
  const W = s.wallet ?? WALLET;
  const payer = s.payer !== false, fee = payer ? (s.fee ?? 5000) : 0;
  const keys = payer ? [W, 'Other11111111111111111111111111111111111111'] : ['Other11111111111111111111111111111111111111', W];
  if (s.tip) keys.push(TIP);
  const wi = keys.indexOf(W);
  const pre = keys.map(() => 0), post = keys.map(() => 0);
  pre[wi] = Number(SOL(s.pre)); post[wi] = Number(SOL(s.post));
  if (s.tip) { pre[keys.indexOf(TIP)] = 1_000_000; post[keys.indexOf(TIP)] = 1_000_000 + Math.round(s.tip * 1e9); }
  const tb = (t: Tok, amount: number | undefined, i: number): TokenBalance | undefined => amount === undefined ? undefined
    : { accountIndex: 10 + (t.idx ?? i), mint: t.mint, owner: W, uiTokenAmount: { amount: String(Math.round(amount * 10 ** t.dec)), decimals: t.dec } };
  const preT = (s.tokens ?? []).flatMap((t, i) => tb(t, t.pre, i) ?? []), postT = (s.tokens ?? []).flatMap((t, i) => tb(t, t.post, i) ?? []);
  const programs = s.programs ?? [];
  return { slot: s.slot, blockTime: s.time, transaction: { message: { accountKeys: keys } },
    meta: { err: s.err ? { InstructionError: [0, 'Custom'] } : null, fee, preBalances: pre, postBalances: post, preTokenBalances: preT, postTokenBalances: postT,
      logMessages: [`Program ComputeBudget111111111111111111111111111111 invoke [1]`, ...programs.map(p => `Program ${p} invoke [1]`), `Program ${programs[0] ?? SYSTEM} success`] } };
}
export const TOKEN = TOKEN_PROGRAM;
