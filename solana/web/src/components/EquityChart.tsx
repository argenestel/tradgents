"use client";

import { useMemo, useState } from "react";
import { CHAIN_UI } from "@/lib/chain";
import { dateLabel, pct, timeLabel, usd } from "@/lib/format";

/** Drawdown is in percent points shown to one decimal; below 0.05 it reads as 0.0% and gets no colour. */
const ddClass = (v: number) => (Math.abs(v) < 0.05 ? "text-muted" : "text-loss");
import type { EquityPoint } from "@/lib/types";

const W = 800;
const H = 210;
const DD_H = 86;
const PAD = 10;

function line(vals: number[], lo: number, hi: number, h: number): string {
  const span = hi - lo || 1;
  return vals.map((v, i) => `${i === 0 ? "M" : "L"}${(i / Math.max(1, vals.length - 1)) * W},${h - PAD - ((v - lo) / span) * (h - PAD * 2)}`).join(" ");
}

const niceUsd = (v: number, range: number) =>
  range >= 20 ? `$${(Math.round(v / (range >= 200 ? 50 : 5)) * (range >= 200 ? 50 : 5)).toLocaleString("en-US")}` : `$${v.toFixed(range >= 2 ? 1 : 2)}`;

/** Labels for the y ticks: add decimals until every tick reads differently (a $0.01 range would otherwise show "$5.52" three times). */
function tickLabels(ticks: number[], range: number): string[] {
  if (range >= 20) return ticks.map((t) => niceUsd(t, range));
  for (let digits = range >= 2 ? 1 : 2; digits <= 4; digits++) {
    const labels = ticks.map((t) => `$${t.toFixed(digits)}`);
    if (new Set(labels).size === labels.length) return labels;
  }
  return ticks.map((t) => `$${t.toFixed(4)}`);
}

/** Equity vs buy-and-hold (both in USD from the same start) with a drawdown panel. Hover for a readout. */
export function EquityChart({ points }: { points: EquityPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const d = useMemo(() => {
    const start = points[0];
    const agent = points.map((p) => p.usd);
    const bench = points.map((p) => (p.sol / start.sol) * start.usd);
    const all = [...agent, ...bench];
    let lo = Math.min(...all);
    let hi = Math.max(...all);
    const padv = (hi - lo) * 0.08 || 1;
    lo -= padv;
    hi += padv;
    const peaks = points.reduce<number[]>((acc, p) => [...acc, Math.max(acc[acc.length - 1] ?? -Infinity, p.usd)], []);
    const dd = points.map((p, k) => ((p.usd - peaks[k]) / peaks[k]) * 100);
    const ddMin = Math.min(...dd, -0.5);
    return { agent, bench, lo, hi, dd, ddMin };
  }, [points]);

  const n = points.length;
  const short = points[n - 1].t - points[0].t < 3 * 86_400_000;
  // Date-only labels repeat on a span of a few days, so fall back to date and time (and fewer ticks) when they would.
  const dayTicks = Array.from({ length: 6 }, (_, k) => Math.round((k / 5) * (n - 1)));
  const useTime = short || new Set(dayTicks.map((k) => dateLabel(points[k].t))).size < dayTicks.length;
  const label = useTime ? timeLabel : dateLabel;
  const xTicks = useTime ? Array.from({ length: 4 }, (_, k) => Math.round((k / 3) * (n - 1))) : dayTicks;
  const i = hover ?? n - 1;
  const yOf = (v: number) => ((d.hi - v) / (d.hi - d.lo)) * 100;
  const ticks = [d.hi - (d.hi - d.lo) * 0.08, (d.hi + d.lo) / 2, d.lo + (d.hi - d.lo) * 0.08];
  const yLabels = tickLabels(ticks, d.hi - d.lo);
  const ddY = (v: number) => (v / d.ddMin) * 100;

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (n - 1)));
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13.5px]" aria-live="polite">
        <span className="num text-muted">{label(points[i].t)}</span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded bg-accent" />
          <span className="font-semibold text-muted">Agent</span>
          <b className="num">{usd(d.agent[i])}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-t-2 border-dashed border-muted" />
          <span className="font-semibold text-muted">Just holding {CHAIN_UI.benchmark}</span>
          <b className="num">{usd(d.bench[i])}</b>
        </span>
        <span className="text-muted">Drop from peak <b className={`num ${ddClass(d.dd[i])}`}>{pct(d.dd[i], { digits: 1 })}</b></span>
      </div>

      <div
        className="relative cursor-crosshair touch-none select-none pl-14 pr-16"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Equity vs ${CHAIN_UI.benchmark} buy-and-hold. Agent ${usd(d.agent[n - 1])}, benchmark ${usd(d.bench[n - 1])}.`}
      >
        {ticks.map((t, k) => (
          <span key={t} className="num pointer-events-none absolute left-0 w-12 -translate-y-1/2 text-right text-[11px] text-muted" style={{ top: `${yOf(t)}%` }}>
            {yLabels[k]}
          </span>
        ))}
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[210px] w-full">
          {ticks.map((t) => (
            <line key={t} x1="0" x2={W} y1={(yOf(t) / 100) * H} y2={(yOf(t) / 100) * H} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
          ))}
          {xTicks.map((k) => (
            <line key={k} x1={(k / (n - 1)) * W} x2={(k / (n - 1)) * W} y1="0" y2={H} stroke="var(--line)" vectorEffect="non-scaling-stroke" opacity="0.6" />
          ))}
          <path d={line(d.bench, d.lo, d.hi, H)} fill="none" stroke="var(--muted)" strokeWidth="1.8" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
          <path d={line(d.agent, d.lo, d.hi, H)} fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {hover !== null && <line x1={(hover / (n - 1)) * W} x2={(hover / (n - 1)) * W} y1="0" y2={H} stroke="var(--muted)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {/* end-point dots + value labels */}
        {[
          { v: d.agent[n - 1], c: "var(--accent)", bold: true },
          { v: d.bench[n - 1], c: "var(--muted)", bold: false },
        ].map((e) => (
          <span key={e.c} className="pointer-events-none absolute right-0 flex -translate-y-1/2 items-center gap-1.5" style={{ top: `${yOf(e.v)}%` }}>
            <span aria-hidden className="absolute -left-[3px] size-2.5 -translate-x-full rounded-full border-2 border-bg" style={{ background: e.c }} />
            <span className={`num pl-1 text-[12px] ${e.bold ? "font-semibold" : "text-muted"}`} style={{ color: e.bold ? e.c : undefined }}>{usd(e.v)}</span>
          </span>
        ))}
        <div className="num mt-1 flex justify-between text-[11px] text-muted">
          {xTicks.map((k) => (
            <span key={k}>{label(points[k].t)}</span>
          ))}
        </div>
      </div>

      <div className="relative mt-3 pl-14 pr-16" aria-hidden>
        {[0, d.ddMin / 2, d.ddMin].map((t) => (
          <span key={t} className="num absolute left-0 w-12 -translate-y-1/2 text-right text-[11px] text-muted" style={{ top: `${ddY(t) * 0.78 + 8}%` }}>
            {t === 0 ? "0%" : pct(t, { digits: 1 })}
          </span>
        ))}
        <svg viewBox={`0 0 ${W} ${DD_H}`} preserveAspectRatio="none" className="block h-[86px] w-full">
          <line x1="0" x2={W} y1="6" y2="6" stroke="var(--line)" vectorEffect="non-scaling-stroke" />
          <path
            d={`M0,6 ${d.dd.map((v, k) => `L${(k / (n - 1)) * W},${6 + (ddY(v) / 100) * (DD_H - 14)}`).join(" ")} L${W},6 Z`}
            fill="rgba(207,48,48,0.12)"
            stroke="var(--loss)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span className={`num absolute right-0 -translate-y-1/2 pl-3 text-[12px] font-semibold ${ddClass(d.dd[n - 1])}`} style={{ top: `${6 + (ddY(d.dd[n - 1]) / 100) * 72}px` }}>
          {pct(d.dd[n - 1], { digits: 1 })}
        </span>
      </div>
    </div>
  );
}
