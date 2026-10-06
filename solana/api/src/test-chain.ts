import { LAMPORTS, ORCA_POOL, ORCA_PROGRAM, USDC, USDC_UNIT, WSOL } from './devnet';
import type { ChainTx } from './wallet';

/** Hand-built `getTransaction` results for tests. Amounts are whole units; the wallet's own balances are given before and after. */
export interface Step { slot: number; time: number; sol: [number, number]; usdc?: [number, number]; fee?: number; payer?: boolean; pool?: { sol: [number, number]; usdc: [number, number] } }
export function chainTx(wallet: string, s: Step): ChainTx {
  const keys = s.payer === false ? ['Faucet1111111111111111111111111111111111', wallet] : [wallet, 'Other111111111111111111111111111111111111'];
  const idx = keys.indexOf(wallet), fee = s.payer === false ? 0 : (s.fee ?? 5000);
  const pre = [0, 0], post = [0, 0];
  pre[idx] = Math.round(s.sol[0] * LAMPORTS); post[idx] = Math.round(s.sol[1] * LAMPORTS) - fee; // the payer also pays the fee
  const tb = (owner: string, mint: string, units: number, unit: number) => ({ accountIndex: 5, mint, owner, uiTokenAmount: { amount: String(Math.round(units * unit)) } });
  const preT = [], postT = [];
  if (s.usdc) { preT.push(tb(wallet, USDC, s.usdc[0], USDC_UNIT)); postT.push(tb(wallet, USDC, s.usdc[1], USDC_UNIT)); }
  if (s.pool) {
    preT.push(tb(ORCA_POOL, WSOL, s.pool.sol[0], LAMPORTS), tb(ORCA_POOL, USDC, s.pool.usdc[0], USDC_UNIT));
    postT.push(tb(ORCA_POOL, WSOL, s.pool.sol[1], LAMPORTS), tb(ORCA_POOL, USDC, s.pool.usdc[1], USDC_UNIT));
  }
  return { slot: s.slot, blockTime: s.time, transaction: { message: { accountKeys: keys } },
    meta: { err: null, fee, preBalances: pre, postBalances: post, preTokenBalances: preT, postTokenBalances: postT,
      logMessages: s.pool ? [`Program ${ORCA_PROGRAM} invoke [1]`, `Program ${ORCA_PROGRAM} success`] : [] } };
}
