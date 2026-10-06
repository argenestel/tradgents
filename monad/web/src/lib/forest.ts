/** Geometry for the forest plot: one shared axis, zero line, clamped so outliers can't flatten everyone else. */
export interface Domain {
  min: number;
  max: number;
  ticks: number[];
}

const CLAMP: [number, number] = [-12, 22];

export function domainFor(intervals: { lo: number; hi: number }[]): Domain {
  const los = intervals.map((i) => i.lo);
  const his = intervals.map((i) => i.hi);
  const rawMin = Math.min(-2, ...los);
  const rawMax = Math.max(4, ...his);
  const min = Math.max(CLAMP[0], Math.floor(rawMin / 2) * 2);
  const max = Math.min(CLAMP[1], Math.ceil(rawMax / 2) * 2);
  const span = max - min;
  const step = span > 24 ? 6 : span > 14 ? 4 : 2;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  if (!ticks.includes(0)) ticks.push(0);
  return { min, max, ticks: ticks.sort((a, b) => a - b) };
}

export const pctOf = (v: number, d: Domain) => ((Math.min(d.max, Math.max(d.min, v)) - d.min) / (d.max - d.min)) * 100;

export type Verdict = "edge" | "luck" | "negative";
/** edge: whole range above zero. negative: whole range below. luck: range spans zero. */
export function verdict(lo: number, hi: number): Verdict {
  if (lo > 0) return "edge";
  if (hi < 0) return "negative";
  return "luck";
}
