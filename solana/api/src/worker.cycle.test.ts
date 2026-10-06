import { expect, it } from 'vitest';
import { STABLES, TOKEN_PROGRAM, WSOL } from './config';
import { JUP, tx, USDC, W } from './ledger-fixtures';
import { migrate } from './migrate';
import { openDb } from './pg';
import type { PriceSource } from './prices';
import type { Rpc } from './rpc';
import { Store } from './store';
import type { Agent } from './types';
import { createWorker } from './worker';

const agent: Agent = { slug: 'a', name: 'A', bio: 'b', runtime: 'codex', verification: 'declared', strategyLabel: 's', wallet: W, protocols: [], startedAt: 0, startCapitalUsd: 0, status: 'stale', bondSol: 0, fingerprint: { avgHoldHours: 0, avgLeverage: 0, tradesPerDay: 0 } };

/** A tiny fake chain: one wallet, a native balance, one devUSDC-like balance, and a list of transactions. */
function fakeChain() {
  const s = { slot: 100, lamports: 2_000_000_000, usdc: 0, txs: [] as { signature: string; slot: number; tx: ReturnType<typeof tx> }[] };
  const rpc = { async call(method: string, params: unknown[]) {
    const ctx = { slot: s.slot };
    if (method === 'getBalance') return { context: ctx, value: s.lamports };
    if (method === 'getTokenAccountsByOwner') {
      const program = (params[1] as { programId: string }).programId;
      return { context: ctx, value: program === TOKEN_PROGRAM && s.usdc > 0 ? [{ account: { data: { parsed: { info: { mint: USDC, tokenAmount: { amount: String(s.usdc), decimals: 6 } } } } } }] : [] };
    }
    if (method === 'getSignaturesForAddress') {
      const o = params[1] as { until?: string; limit: number };
      const all = [...s.txs].reverse().map(t => ({ signature: t.signature, slot: t.slot, err: null, blockTime: 1 }));
      const stop = o.until ? all.findIndex(t => t.signature === o.until) : -1;
      return (stop >= 0 ? all.slice(0, stop) : all).slice(0, o.limit);
    }
    if (method === 'getTransaction') return s.txs.find(t => t.signature === params[0])!.tx;
    throw new Error(`unexpected ${method}`);
  } } as unknown as Rpc;
  return { s, rpc };
}
const prices: PriceSource = { async get(mints) { return new Map(mints.flatMap(m => (m === WSOL ? [[m, { usd: 100, liquidityUsd: 1e9, source: 'test' }]] : Object.hasOwn(STABLES, m) ? [[m, { usd: 1, liquidityUsd: Infinity, source: 'stable' }]] : [])) as never); } };

it('opens at registration, replays a later swap, and agrees with the chain', async () => {
  const db = await openDb('memory:'); await migrate(db);
  const store = new Store(db), { s, rpc } = fakeChain();
  await store.putAgent(agent);
  let now = Date.UTC(2026, 9, 6, 12);
  const worker = createWorker({ store, rpc, prices, cfg: { programId: '73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA', POLL_SECONDS: 1 }, now: () => now });
  await worker.cycle(); // opening snapshot, nothing to replay
  expect((await store.opening('a'))!.slot).toBe(100);
  expect(await store.trades('a')).toEqual([]);
  // the agent sells 1 SOL for 100 devUSDC on Jupiter at slot 105, paying a 5000 lamport fee
  now += 60_000; s.slot = 105; s.lamports = 1_000_000_000 - 5000; s.usdc = 100_000_000;
  s.txs.push({ signature: 'swap1', slot: 105, tx: tx({ slot: 105, time: Math.floor(now / 1000), pre: 2, post: 1 - 0.000005, tokens: [{ mint: USDC, dec: 6, pre: 0, post: 100 }], programs: [JUP] }) });
  await worker.cycle();
  const trades = await store.trades('a');
  expect(trades).toHaveLength(1); expect(trades[0].meta.pair).toBe('SOL → USDC');
  const stats = await store.stats('a');
  expect(stats!.flags.drift).toBe(false); expect(stats!.flags.unpricedHeld).toEqual([]);
  const eq = await store.equity('a');
  expect(eq.at(-1)!.usd).toBeCloseTo(199.9995, 3); // 1 SOL * 100 + 100 USDC - the fee
  expect(eq[0].flow).toBeCloseTo(200, 6); // opening holdings are a flow, not a return
  await db.close();
});
