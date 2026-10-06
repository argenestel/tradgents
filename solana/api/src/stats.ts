import { DAY } from './format';
import { detail } from './metrics';
import type { Flags, StatsRow, Valuation } from './store';
import type { Agent, Interaction, WindowKey } from './types';

/** Equity series with deposits and withdrawals removed: each step keeps only the wallet's own percentage change. */
export function withoutFlows(points: Valuation[]): Valuation[] {
  if (!points.length) return [];
  const out: Valuation[] = [{ t: points[0].t, usd: points[0].usd, sol: points[0].sol }];
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1].usd, after = points[i].usd - (points[i].flow ?? 0), prev = out[i - 1].usd;
    out.push({ t: points[i].t, sol: points[i].sol, usd: before > 0 && after > 0 ? prev * after / before : prev });
  }
  return out;
}

/** Thin a long series for the API. Flows of dropped points are folded into the next kept point so returns stay exact. */
export function downsample(points: Valuation[], max = 600): Valuation[] {
  if (points.length <= max) return points;
  const step = points.length / max, out: Valuation[] = [];
  let carry = 0, next = 0;
  points.forEach((p, i) => {
    carry += p.flow ?? 0;
    if (i >= next || i === points.length - 1) { out.push({ t: p.t, usd: p.usd, sol: p.sol, ...(carry ? { flow: carry } : {}) }); carry = 0; next += step; }
  });
  return out;
}

/** One point per UTC day for the last 30 days, deposit-adjusted and rebased to 100. */
export function sparkOf(equity: Valuation[], now: number): number[] {
  const adj = withoutFlows(equity.filter(p => p.t >= now - 30 * DAY || p === equity[0]));
  const byDay = new Map<number, number>();
  for (const p of adj) byDay.set(Math.floor(p.t / DAY), p.usd);
  const series = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  if (series.length < 2 || !(series[0] > 0)) return [100, 100];
  return series.map(v => Number((v / series[0] * 100).toFixed(2)));
}

const WINDOWS: Record<WindowKey, number> = { '7d': 7 * DAY, '30d': 30 * DAY, all: Infinity };

/** Why this agent cannot be ranked in a window, if anything. A ranked score must cover everything the agent held and did. */
export function blockers(flags: Flags, window: WindowKey, now: number): string[] {
  const start = now - WINDOWS[window], why: string[] = [];
  const u = flags.unsupportedTs.filter(t => t >= start).length;
  if (u) why.push(`${u} transaction${u === 1 ? '' : 's'} on programs we cannot value yet`);
  const p = flags.unpricedTouchTs.filter(t => t >= start).length;
  if (p) why.push(`${p} trade${p === 1 ? '' : 's'} in tokens with no market price`);
  if (flags.unpricedHeld.length) why.push(`Holds ${flags.unpricedHeld.length} token${flags.unpricedHeld.length === 1 ? '' : 's'} with no market price`);
  if (flags.drift) why.push('Our ledger did not match the chain; it is being re-checked');
  return why;
}

export function buildStats(agent: Agent, equity: Valuation[], trades: Interaction[], flags: Flags, now: number): StatsRow {
  const d = detail(agent, equity, trades, now), metrics = d.metrics;
  for (const w of Object.keys(WINDOWS) as WindowKey[]) if (blockers(flags, w, now).length) metrics[w] = { ...metrics[w], eligible: false };
  return { equityUsd: d.equityUsd, tier: d.tier, metrics, spark: sparkOf(equity, now), notes: blockers(flags, '30d', now), flags };
}
