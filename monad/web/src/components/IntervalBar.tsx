import { pctOf, verdict, type Domain } from "@/lib/forest";
import { num } from "@/lib/format";

/**
 * One agent's 95% Sharpe range on the shared axis.
 * White solid = the whole range is above zero. Hatched amber = it spans zero (could be luck).
 * Pale red = the whole range is below zero. The bar draws out from the zero line.
 */
export function IntervalBar({ lo, point, hi, domain, index = 0, label }: { lo: number; point: number; hi: number; domain: Domain; index?: number; label: string }) {
  const v = verdict(lo, hi);
  const l = pctOf(lo, domain);
  const h = pctOf(hi, domain);
  const p = pctOf(point, domain);
  const zero = pctOf(0, domain);
  const w = Math.max(0.6, h - l);
  const origin = w > 0 ? Math.min(100, Math.max(0, ((zero - l) / w) * 100)) : 50;
  const clippedLo = lo < domain.min;
  const clippedHi = hi > domain.max;
  const tone = v === "edge" ? "bg-white" : v === "negative" ? "bg-[#ffb4aa]" : "hatch-luck";

  return (
    <div className="relative h-full min-h-[44px] w-full" role="img" aria-label={`${label}: Sharpe ${num(point, 2)}, 95% range ${num(lo, 1)} to ${num(hi, 1)}${v === "luck" ? ", could be luck" : ""}`}>
      {domain.ticks.map((t) => (
        <span key={t} aria-hidden className={`absolute inset-y-0 w-px ${t === 0 ? "bg-white" : "bg-white/15"}`} style={{ left: `${pctOf(t, domain)}%` }} />
      ))}
      <span
        aria-hidden
        className={`draw absolute top-1/2 h-[12px] -translate-y-1/2 rounded-[2px] ${tone}`}
        style={{ left: `${l}%`, width: `${w}%`, ["--origin" as string]: `${origin}%`, ["--i" as string]: index }}
      />
      {/* whisker caps */}
      <span aria-hidden className="absolute top-1/2 h-[20px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: `${l}%` }} />
      <span aria-hidden className="absolute top-1/2 h-[20px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ left: `${h}%` }} />
      {/* point estimate */}
      <span aria-hidden className="absolute top-1/2 size-[16px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-accent bg-white" style={{ left: `${p}%` }} />
      {clippedLo && <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 pl-0.5 text-[11px] font-bold text-white">◂</span>}
      {clippedHi && <span aria-hidden className="absolute right-0 top-1/2 -translate-y-1/2 pr-0.5 text-[11px] font-bold text-white">▸</span>}
    </div>
  );
}

/** Axis labels for the plot, aligned to the same domain. */
export function ForestAxis({ domain }: { domain: Domain }) {
  return (
    <div className="relative h-7 w-full text-[12px] font-semibold text-white/80" aria-hidden>
      {domain.ticks.map((t) => (
        <span key={t} className={`num absolute top-1 -translate-x-1/2 ${t === 0 ? "text-white" : ""}`} style={{ left: `${pctOf(t, domain)}%` }}>
          {t === 0 ? "0" : t > 0 ? `+${t}` : `−${Math.abs(t)}`}
        </span>
      ))}
    </div>
  );
}
