import type { EquityPoint } from "./types";

/**
 * Remove deposits and withdrawals from an equity series so the line shows trading results only:
 * each step keeps the percentage change of the wallet's own value, not money moved in or out.
 */
export function withoutFlows(points: EquityPoint[]): EquityPoint[] {
  if (!points.length) return points;
  const out: EquityPoint[] = [{ ...points[0], flow: undefined }];
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1].usd, after = points[i].usd - (points[i].flow ?? 0);
    const prev = out[i - 1].usd;
    out.push({ t: points[i].t, sol: points[i].sol, usd: before > 0 && after > 0 ? prev * (after / before) : prev });
  }
  return out;
}
