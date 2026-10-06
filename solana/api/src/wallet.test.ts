import { describe, expect, it } from 'vitest';
import { Store } from './db';
import { chainTx, type Step } from './test-chain';
import type { Agent } from './types';
import { analyze, rebuildAgent, replay } from './wallet';

const W = 'EET2cUX1nrFcQ12vBuyFsXfNACmSm1gs93jCsFiLvsSk';
const agent: Agent = { slug: 'a', name: 'A', bio: 'b', runtime: 'codex', verification: 'declared', strategyLabel: 's', wallet: W, protocols: [], startedAt: 0, startCapitalUsd: 0, status: 'stale', bondSol: 0, fingerprint: { avgHoldHours: 0, avgLeverage: 0, tradesPerDay: 0 } };
const T0 = Date.UTC(2026, 9, 1) / 1000;
// Faucet 2 SOL; sell 1 SOL for 100.5 USDC; buy 0.5 SOL with 50 USDC.
const steps: Step[] = [
  { slot: 1, time: T0, sol: [0, 2], payer: false },
  { slot: 2, time: T0 + 60, sol: [2, 1], usdc: [0, 100.5], pool: { sol: [10, 11], usdc: [1000, 899.5] } },
  { slot: 3, time: T0 + 120, sol: [1, 1.5], usdc: [100.5, 50.5], pool: { sol: [11, 10.5], usdc: [899.5, 949.5] } },
];
const facts = () => steps.map((s, i) => analyze(W, `sig${i}`, chainTx(W, s))!);

describe('analyze', () => {
  it('reads wallet deltas excluding the fee and detects pool swaps by pool-side balances', () => {
    const [deposit, sell, buy] = facts();
    expect(deposit).toMatchObject({ solDelta: 2, usdcDelta: 0, fee: 0 }); expect(deposit.swap).toBeUndefined();
    expect(sell.swap).toEqual({ solIn: 1, usdcOut: 100.5 }); expect(sell.solDelta).toBeCloseTo(-1, 9);
    expect(buy.swap).toEqual({ solIn: -0.5, usdcOut: -50 });
  });
  it('does not call something a swap when pool deltas disagree with the wallet', () => {
    const bad = chainTx(W, { ...steps[1], pool: { sol: [10, 11], usdc: [1000, 900] } });
    expect(analyze(W, 'x', bad)!.swap).toBeUndefined();
  });
  it('ignores failed transactions and wallets not in the transaction', () => {
    const failed = chainTx(W, steps[0]); failed.meta!.err = { InstructionError: [0, 'Custom'] };
    expect(analyze(W, 'x', failed)).toBeUndefined(); expect(analyze('Other', 'x', chainTx(W, steps[0]))).toBeUndefined();
  });
});

describe('replay', () => {
  const result = () => replay(agent, facts(), { feeRate: 0.0004, fallbackPrice: 100 });
  it('treats the faucet as a flow and realizes PnL against FIFO cost', () => {
    const r = result();
    expect(r.netFlowUsd).toBeCloseTo(200, 6); expect(r.points[0]).toMatchObject({ usd: 200, flow: 200 }); expect(r.points[1].flow).toBe(0);
    const [sell, buy] = r.interactions;
    expect(sell.meta.pair).toBe('SOL → USDC');
    const price = sell.components.find(c => c.label === 'price')!.usd, fee = sell.components.find(c => c.label === 'swapFee')!.usd;
    expect(price).toBeCloseTo(100.5 / 0.9996 - 100, 4); expect(fee).toBeCloseTo(-(100.5 / 0.9996 - 100.5), 4);
    expect(sell.pnlUsd).toBeCloseTo(0.5 - 5000 / 1e9 * 100, 5); expect(sell.pnlUsd).toBeCloseTo(sell.components.reduce((s, c) => s + c.usd, 0), 9);
    expect(buy.meta.pair).toBe('USDC → SOL'); expect(buy.components.some(c => c.label === 'price')).toBe(false);
    expect(buy.pnlUsd).toBeLessThan(0);
  });
  it('keeps equity consistent with balances at the trade price', () => {
    const r = result();
    const mid = 100.5 / 0.9996;
    expect(r.points[1].usd).toBeCloseTo((1 - 5000 / 1e9) * mid + 100.5, 5);
    expect(r.points[2].sol).toBeCloseTo(100 * 0.9996, 5); // a buy's fill includes the fee, so mid is lower
  });
  it('carries devUSDC through transactions that do not touch the token account', () => {
    const quiet = chainTx(W, { slot: 4, time: T0 + 180, sol: [1.5, 1.4] }); // e.g. a registry call: no token balances listed
    const r = replay(agent, [...facts(), analyze(W, 'quiet', quiet)!], { feeRate: 0.0004, fallbackPrice: 100 });
    const swapPoint = r.points[2], quietPoint = r.points[3];
    expect(quietPoint.usd).toBeCloseTo(swapPoint.usd - 0.1 * quietPoint.sol, 2); // only 0.1 SOL left; devUSDC is still counted
    expect(quietPoint.flow).toBeCloseTo(-0.1 * quietPoint.sol, 3);
  });
  it('is deterministic and gives each transaction its own timestamp', () => {
    const same = facts().map(f => ({ ...f, ts: T0 * 1000 }));
    const r = replay(agent, same, { feeRate: 0, fallbackPrice: 100 });
    expect(new Set(r.points.map(p => p.ts)).size).toBe(3); expect(result()).toEqual(result());
  });
});

describe('rebuildAgent', () => {
  it('rewrites trades, trade posts and equity from stored transactions, idempotently', () => {
    const store = new Store(':memory:'); store.putAgent(agent);
    steps.forEach((s, i) => store.db.prepare('INSERT INTO raw_transactions VALUES(?,?,?,?,?)').run(`sig${i}`, W, s.slot, s.time, JSON.stringify(chainTx(W, s))));
    expect(rebuildAgent(store, 'a', { feeRate: 0.0004, price: 100 })).toBe(2);
    expect(rebuildAgent(store, 'a', { feeRate: 0.0004, price: 100 })).toBe(2);
    expect(store.rows('SELECT data FROM trades')).toHaveLength(2); expect(store.rows('SELECT data FROM posts')).toHaveLength(2);
    expect(store.rows('SELECT data FROM equity')).toHaveLength(3); expect(store.agent('a')!.protocols).toContain('orca');
    store.close();
  });
});
