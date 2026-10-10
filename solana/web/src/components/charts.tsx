import { COMPONENTS } from "@/lib/protocols";
import { usd } from "@/lib/format";
import type { PnlComponent } from "@/lib/types";

/** Tiny server-rendered sparkline. */
export function Sparkline({ values, width = 84, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="text-xs text-muted">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 4) - 2}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={up ? "trending up" : "trending down"}>
      <polyline points={pts} fill="none" stroke={up ? "var(--gain)" : "var(--loss)"} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Profit decomposition as a ledger: each line floats from where the previous one ended, the last line is the net.
 * Estimated lines are hatched. Values always carry a sign and an arrow, so colour is never the only signal.
 */
export function Waterfall({ items, unrealizedUsd }: { items: { label: PnlComponent; usd: number }[]; unrealizedUsd?: number }) {
  type Row = { key: string; label: string; usd: number; estimated?: boolean; start: number; end: number; total?: boolean };
  const rows: Row[] = [];
  let run = 0;
  for (const it of items) {
    const meta = COMPONENTS[it.label];
    rows.push({ key: it.label, label: meta.label.replace(" (est.)", "").replace(" (limit × price)", ""), usd: it.usd, estimated: meta.estimated, start: run, end: run + it.usd });
    run += it.usd;
  }
  if (unrealizedUsd !== undefined) {
    rows.push({ key: "unrealized", label: "Open positions", usd: unrealizedUsd, start: run, end: run + unrealizedUsd });
    run += unrealizedUsd;
  }
  rows.push({ key: "net", label: "Net result", usd: run, start: 0, end: run, total: true });

  const lo = Math.min(0, ...rows.flatMap((r) => [r.start, r.end]));
  const hi = Math.max(0, ...rows.flatMap((r) => [r.start, r.end]));
  const span = hi - lo || 1;
  const x = (v: number) => ((v - lo) / span) * 100;
  const zero = x(0);

  return (
    <div role="table" aria-label="Where the profit came from">
      {rows.map((r) => {
        const left = x(Math.min(r.start, r.end));
        const width = Math.max(0.8, Math.abs(x(r.end) - x(r.start)));
        const pos = r.usd >= 0;
        const flat = Math.abs(r.usd) < 0.0005; // would print as $0.000: no colour, no arrow
        const tone = r.total ? "bg-fg" : r.estimated ? "hatch" : pos ? "bg-[#1a9d6a]" : "bg-[#d94a43]";
        return (
          <div key={r.key} role="row" className={`grid grid-cols-[minmax(96px,150px)_1fr_5.75rem] items-center gap-3 py-[7px] ${r.total ? "mt-1 border-t-2 border-fg pt-3" : "border-b border-line"}`}>
            <div role="cell" className={`truncate text-[14px] ${r.total ? "font-extrabold" : "text-muted"}`}>{r.label}</div>
            <div role="cell" className="relative h-[18px]">
              <span aria-hidden className="absolute inset-y-[-7px] w-px bg-line" style={{ left: `${zero}%` }} />
              <span aria-hidden className={`absolute inset-y-[3px] rounded-[2px] ${tone}`} style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <div role="cell" className={`num text-right text-[14px] ${r.total ? "font-extrabold" : "font-bold"} ${flat ? "text-muted" : pos ? "text-gain" : "text-loss"}`}>
              {!flat && <span aria-hidden className="mr-1 text-[9px]">{pos ? "▲" : "▼"}</span>}
              {usd(r.usd, { sign: true })}
            </div>
          </div>
        );
      })}
      {rows.some((r) => r.estimated) && <p className="mt-2 text-[13px] text-warn">Hatched lines are estimates, not exact on-chain amounts.</p>}
    </div>
  );
}
