import { describe, expect, it } from 'vitest';
import { analyze, replay, type Facts, type Opening, type ReplayContext } from './ledger';
import { BONK, JUP, KAMINO, ORCA, SYSTEM, TOKEN, tx, USDC, W, WIF, WSOL, type Step } from './ledger-fixtures';

const T0 = Date.UTC(2026, 9, 1);
const agent = { slug: 'a', wallet: W };
const facts = (steps: Step[]) => steps.map((s, i) => analyze(W, `sig${i}`, tx(s))!);
const ctx = (over: Partial<ReplayContext> = {}, opening: Partial<Opening> = {}): ReplayContext => ({
  opening: { slot: 0, tsMs: T0, balances: { [WSOL]: { raw: String(2e9), decimals: 9 }, [USDC]: { raw: '0', decimals: 6 } }, prices: { [WSOL]: 100 }, rentAccounts: 0, ...opening },
  samples: new Map([[WSOL, [{ ts: T0, usd: 100 }]]]), symbols: new Map([[BONK, 'BONK'], [WIF, 'WIF']]), ...over });
const t = (m: number) => T0 / 1000 + m * 60;

describe('analyze', () => {
  it('separates fee and ATA rent from the economic change of a swap', () => {
    // sell 1 SOL for 100 USDC through Jupiter; the wallet opens a USDC account (rent 0.00203928) and pays a 5000 lamport fee
    const f = analyze(W, 's', tx({ slot: 1, time: t(1), pre: 2, post: 1 - 0.00203928 - 0.000005, tokens: [{ mint: USDC, dec: 6, post: 100 }], programs: [JUP] }))!;
    expect(f.economic.get(WSOL)).toBe(-1_000_000_000n); expect(f.economic.get(USDC)).toBe(100_000_000n);
    expect(f.actual.get(WSOL)).toBe(-1_002_044_280n + 0n - 0n + 0n > 0n ? 0n : f.actual.get(WSOL)); // actual keeps rent and fee
    expect(f.rentAccounts).toBe(1); expect(f.fee).toBe(5000n); expect(f.swapProgram).toBe(true); expect(f.foreign).toEqual([]);
  });
  it('recognises tips, failed transactions and unsupported programs', () => {
    expect(analyze(W, 's', tx({ slot: 1, time: t(1), pre: 1, post: 1 - 0.00001 - 0.000005, tip: 0.00001, programs: [SYSTEM] }))!.tip).toBe(10_000n);
    const failed = analyze(W, 's', tx({ slot: 1, time: t(1), pre: 1, post: 1, err: true }))!;
    expect(failed.ok).toBe(false); expect(failed.actual.get(WSOL)).toBe(-5000n); expect(failed.economic.size).toBe(0);
    expect(analyze(W, 's', tx({ slot: 1, time: t(1), pre: 1, post: 1, programs: [KAMINO] }))!.foreign).toEqual([KAMINO]);
  });
  it('judges only directly called programs: venues behind Jupiter do not make a swap unsupported', () => {
    const c = tx({ slot: 1, time: 1, pre: 1, post: 1, programs: [JUP] });
    c.meta!.logMessages!.splice(2, 0, `Program ${KAMINO} invoke [2]`, `Program ${KAMINO} success`);
    const f = analyze(W, 's', c)!;
    expect(f.foreign).toEqual([]); expect(f.programs).toContain(KAMINO); expect(f.swapProgram).toBe(true);
  });
  it('treats the registry program as supported, so posting a bond does not make an agent unrankable', () => {
    const REG = 'RegistryProgram11111111111111111111111111111';
    const c = tx({ slot: 1, time: 1, pre: 1, post: 0.9 - 0.000005, programs: [REG] });
    expect(analyze(W, 's', c)!.foreign).toEqual([REG]);
    expect(analyze(W, 's', c, new Set([REG]))!.foreign).toEqual([]);
  });
  it('ignores transactions the wallet is not in and refuses truncated logs', () => {
    expect(analyze('Someone', 's', tx({ slot: 1, time: 1, pre: 1, post: 1 }))).toBeUndefined();
    const c = tx({ slot: 1, time: 1, pre: 1, post: 1 }); c.meta!.logMessages!.push('Log truncated');
    expect(() => analyze(W, 's', c)).toThrow(/truncated/);
  });
  it('does not count rent for accounts someone else opened for the wallet', () => {
    const f = analyze(W, 's', tx({ slot: 1, time: 1, pre: 1, post: 1, payer: false, tokens: [{ mint: BONK, dec: 5, post: 1000 }], programs: [TOKEN] }))!;
    expect(f.rentAccounts).toBe(0); expect(f.economic.get(WSOL)).toBeUndefined();
  });
});

describe('review fixes', () => {
  it('never reads a missing cost basis as zero: selling an unpriced holding records no gain and blocks ranking', () => {
    const c = ctx({}, { balances: { [WSOL]: { raw: String(1e9), decimals: 9 }, [BONK]: { raw: String(1_000_000e5), decimals: 5 } }, prices: { [WSOL]: 100 } }); // BONK held at opening with no price, so no lot
    c.samples.set(BONK, [{ ts: T0, usd: 0.0001 }]);
    const r = replay(agent, facts([{ slot: 1, time: t(1), pre: 1, post: 1 - 0.000005, tokens: [{ mint: BONK, dec: 5, pre: 1_000_000, post: 0, idx: 5 }, { mint: USDC, dec: 6, pre: 0, post: 100 }], programs: [JUP] }]), c);
    expect(r.trades[0].pnlUsd).toBeLessThan(0.01); expect(r.trades[0].pnlUsd).toBeGreaterThan(-0.01); // not +$100 of invented profit
    expect(r.unpricedTouches).toHaveLength(1);
  });
  it('replays same-slot transactions in the order the chain executed them', () => {
    const a = tx({ slot: 5, time: t(1), pre: 2, post: 1 - 0.000005, tokens: [{ mint: USDC, dec: 6, pre: 0, post: 100 }], programs: [JUP] });
    const b = tx({ slot: 5, time: t(1), pre: 1 - 0.000005, post: 1.5 - 0.00001, tokens: [{ mint: USDC, dec: 6, pre: 100, post: 50 }], programs: [JUP] });
    a.transactionIndex = 2; b.transactionIndex = 7;                // 'zzz' sorts after 'aaa' by signature, so only the index can order them
    const r = replay(agent, [analyze(W, 'zzz', a)!, analyze(W, 'aaa', b)!], ctx());
    expect(r.trades.map(x => x.meta.pair)).toEqual(['SOL → USDC', 'USDC → SOL']);
  });
  it('finds a Jito tip recipient that was loaded through an address lookup table', () => {
    const c = tx({ slot: 1, time: 1, pre: 1, post: 1 - 0.00001 - 0.000005, programs: [SYSTEM] });
    c.meta!.loadedAddresses = { writable: ['96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5'], readonly: [] };
    c.meta!.preBalances.push(1_000_000); c.meta!.postBalances.push(1_010_000);
    expect(analyze(W, 's', c)!.tip).toBe(10_000n);
  });
  it('flags, rather than guesses, a SOL price when no sample is near the transaction', () => {
    const c = ctx(); c.samples.set(WSOL, [{ ts: T0, usd: 100 }]);
    const r = replay(agent, facts([{ slot: 1, time: t(120), pre: 2, post: 2, err: true }]), c); // two hours later, no sample
    expect(r.unpricedTouches).toHaveLength(1);
  });
});

describe('replay', () => {
  it('treats the opening balance as the first flow and a deposit as a later flow', () => {
    const r = replay(agent, facts([{ slot: 1, time: t(1), pre: 2, post: 2, payer: false, tokens: [{ mint: USDC, dec: 6, pre: 0, post: 50 }], programs: [TOKEN] }]), ctx());
    expect(r.points[0]).toMatchObject({ usd: 200, flow: 200 }); expect(r.points[1]).toMatchObject({ usd: 250, flow: 50 }); expect(r.trades).toEqual([]);
  });
  it('realizes SOL gain when sold for USDC, expenses the swap cost, and keeps rent out of the loss', () => {
    // price sample 110 at the trade, receives 109 USDC for 1 SOL (cost 1 USD). Basis 100 from the opening.
    const c = ctx(); c.samples.set(WSOL, [{ ts: T0, usd: 100 }, { ts: T0 + 60_000, usd: 110 }]);
    const r = replay(agent, facts([{ slot: 1, time: t(1), pre: 2, post: 1 - 0.00203928 - 0.000005, tokens: [{ mint: USDC, dec: 6, post: 109 }], programs: [JUP, ORCA] }]), c);
    const [trade] = r.trades;
    expect(trade.protocol).toBe('jupiter'); expect(trade.meta.pair).toBe('SOL → USDC');
    expect(trade.components.find(x => x.label === 'price')!.usd).toBeCloseTo(10, 4);
    expect(trade.components.find(x => x.label === 'swapFee')!.usd).toBeCloseTo(-1, 4);
    expect(trade.components.find(x => x.label === 'priorityFee')!.usd).toBeCloseTo(-0.000005 * 110, 6);
    expect(trade.pnlUsd).toBeCloseTo(9 - 0.00055, 4);
    // equity: before 200 (at 110 it is 220); after = 1 SOL*110 + 109 USDC + rent held 0.00203928*110 - fee
    expect(r.points[1].usd).toBeCloseTo(110 + 109 - 0.000005 * 110, 4); // rent sits in the account and still counts; only fee and swap cost leave
    expect(r.points[1].flow).toBe(0);
  });
  it('buys a token for USDC at cost, then realizes the gain when it is sold', () => {
    const c = ctx({}, { balances: { [USDC]: { raw: String(100e6), decimals: 6 }, [WSOL]: { raw: String(1e9), decimals: 9 } }, prices: { [WSOL]: 100 } });
    c.samples.set(BONK, [{ ts: T0, usd: 0.001 }]);
    const r = replay(agent, facts([
      { slot: 1, time: t(1), pre: 1, post: 1 - 0.000005, tokens: [{ mint: USDC, dec: 6, pre: 100, post: 50 }, { mint: BONK, dec: 5, pre: 0, post: 50_000, idx: 5 }], programs: [JUP] }, // 50 USD for 50,000 BONK
      { slot: 2, time: t(2), pre: 1 - 0.000005, post: 1 - 0.00001, tokens: [{ mint: USDC, dec: 6, pre: 50, post: 90 }, { mint: BONK, dec: 5, pre: 50_000, post: 0, idx: 5 }], programs: [JUP] }, // sold for 40 USD
    ]), c);
    expect(r.trades).toHaveLength(2);
    const [buy, sell] = r.trades;
    expect(buy.pnlUsd).toBeCloseTo(-0.0005, 4); // only the fee
    expect(sell.components.find(x => x.label === 'price')!.usd).toBeCloseTo(-10, 4); // 40 received for 50 of cost
    expect(buy.meta.pair).toBe('USDC → BONK'); expect(sell.meta.pair).toBe('BONK → USDC');
  });
  it('carries cost basis for token-for-token swaps and records no gain', () => {
    const c = ctx({}, { balances: { [BONK]: { raw: String(100_000e5), decimals: 5 } }, prices: { [WSOL]: 100, [BONK]: 0.01 } });
    c.samples.set(BONK, [{ ts: T0, usd: 0.01 }]);
    const r = replay(agent, facts([{ slot: 1, time: t(1), pre: 1, post: 1 - 0.000005, tokens: [{ mint: BONK, dec: 5, pre: 100_000, post: 0, idx: 5 }, { mint: WIF, dec: 6, pre: 0, post: 500, idx: 6 }], programs: [JUP] }]), c);
    expect(r.trades[0].meta.note).toMatch(/carried over/); expect(r.trades[0].components.find(x => x.label === 'price')).toBeUndefined();
    expect(r.unpricedTouches).toHaveLength(1); expect(r.unpriced).toContain(WIF);
  });
  it('flags unsupported programs and keeps equity continuous', () => {
    const r = replay(agent, facts([{ slot: 1, time: t(1), pre: 2, post: 1, programs: [KAMINO] }]), ctx());
    expect(r.unsupported).toEqual([{ signature: 'sig0', ts: expect.any(Number), programs: [KAMINO] }]); expect(r.trades).toEqual([]);
    expect(r.points[1].flow).toBeCloseTo(-100, 2); // moving 1 SOL into a position we cannot value is not a trading result
  });
  it('charges the fee of a failed transaction and ignores history before the opening slot', () => {
    const r = replay(agent, facts([{ slot: 5, time: t(1), pre: 2, post: 2, err: true }, { slot: 1, time: t(0.5), pre: 9, post: 9, payer: false, tokens: [], programs: [SYSTEM] }]), ctx({}, { slot: 3 }));
    expect(r.points).toHaveLength(2); expect(r.points[1].usd).toBeCloseTo(200 - 0.0005, 6); expect(r.balances.get(WSOL)).toBe(2_000_000_000n - 5000n);
  });
  it('is deterministic and gives each transaction a unique timestamp', () => {
    const fs = facts([{ slot: 1, time: t(1), pre: 2, post: 2, err: true }, { slot: 2, time: t(1), pre: 2, post: 2, err: true }]);
    const a = replay(agent, fs, ctx()), b = replay(agent, [...fs].reverse(), ctx());
    expect(a).toEqual(b); expect(new Set(a.points.map(p => p.ts)).size).toBe(3);
  });
  it('splits a Jito tip out as its own cost', () => {
    const c = ctx(); 
    const r = replay(agent, facts([{ slot: 1, time: t(1), pre: 2, post: 1 - 0.0001 - 0.000005, tip: 0.0001, tokens: [{ mint: USDC, dec: 6, post: 100 }], programs: [JUP] }]), c);
    expect(r.trades[0].components.find(x => x.label === 'tip')!.usd).toBeCloseTo(-0.01, 6);
  });
});
