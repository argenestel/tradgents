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

const BAR_AREA = 168;

/**
 * Vertical profit waterfall: each component floats from where the previous one
 * ended; the last bar is the net. Estimated components are hatched. Values are
 * always printed (sign + arrow), so colour is never the only signal.
 */
export function Waterfall({ items, unrealizedUsd }: { items: { label: PnlComponent; usd: number }[]; unrealizedUsd?: number }) {
  type Col = { key: string; label: string; usd: number; estimated?: boolean; start: number; end: number; total?: boolean };
  const cols: Col[] = [];
  let run = 0;
  for (const it of items) {
    const meta = COMPONENTS[it.label];
    cols.push({ key: it.label, label: meta.label.replace(" (est.)", "").replace(" (limit × price)", "").replace("Lending interest", "Lending interest"), usd: it.usd, estimated: meta.estimated, start: run, end: run + it.usd });
    run += it.usd;
  }
  if (unrealizedUsd !== undefined) {
    cols.push({ key: "unrealized", label: "Unrealized", usd: unrealizedUsd, start: run, end: run + unrealizedUsd });
    run += unrealizedUsd;
  }
  cols.push({ key: "net", label: "Net", usd: run, start: 0, end: run, total: true });

  const lo = Math.min(0, ...cols.flatMap((c) => [c.start, c.end]));
  const hi = Math.max(0, ...cols.flatMap((c) => [c.start, c.end]));
  const span = hi - lo || 1;
  const y = (v: number) => ((v - lo) / span) * BAR_AREA;
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${v < 0 ? "−" : "+"}${Math.abs(Math.round(v)).toLocaleString("en-US")}` : `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(Math.abs(v) < 100 ? 1 : 0)}`);

  return (
    <div role="table" aria-label="Profit decomposition" className="overflow-x-auto">
      <div className="flex min-w-[560px] gap-3 pt-6" style={{ height: BAR_AREA + 56 }}>
        {cols.map((c, i) => {
          const bottom = y(Math.min(c.start, c.end));
          const h = Math.max(2, Math.abs(y(c.end) - y(c.start)));
          const pos = c.usd >= 0;
          const tone = c.total ? "bg-accent" : c.estimated ? "hatch" : pos ? "bg-[#1fb865]" : "bg-[#ef6b68]";
          return (
            <div key={c.key} role="row" className="relative flex-1" style={{ minWidth: 48 }}>
              <div role="cell" className="relative" style={{ height: BAR_AREA }}>
                <span
                  className={`num absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[12px] font-semibold ${c.total ? "text-accent" : pos ? "text-gain" : "text-loss"}`}
                  style={{ bottom: bottom + h + 3 }}
                >
                  <span aria-hidden className="mr-0.5 text-[9px]">{pos ? "▲" : "▼"}</span>
                  {fmt(c.usd)}
                </span>
                <span className={`absolute inset-x-1 rounded-[3px] ${tone}`} style={{ bottom, height: h }} aria-hidden />
                {i < cols.length - 1 && (
                  <span aria-hidden className="absolute border-t border-dashed border-line" style={{ bottom: y(c.end), left: "calc(100% - 4px)", width: 16 }} />
                )}
              </div>
              <div role="cell" className={`mt-2 text-center text-[11.5px] leading-tight ${c.total ? "font-semibold text-fg" : "text-muted"}`}>{c.label}</div>
            </div>
          );
        })}
      </div>
      {cols.some((c) => c.estimated) && <p className="mt-1 text-[11px] text-warn">Hatched = estimated, not an exact on-chain amount.</p>}
    </div>
  );
}

export { usd as _usd };
