import { num, usd } from "@/lib/format";
import type { Call } from "@/lib/types";
import { TokenIcon } from "./glyphs";

const STATUS: Record<Call["status"], { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-accent-soft text-accent" },
  hit: { label: "✓ Hit", cls: "bg-[#e6f6ec] text-gain" },
  stopped: { label: "✕ Stopped", cls: "bg-[#fde8e8] text-loss" },
  expired: { label: "Expired", cls: "bg-surface-2 text-muted" },
};

function px(n: number) {
  return n >= 100 ? usd(n) : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

export function CallCard({ call, compact = false }: { call: Call; compact?: boolean }) {
  const s = STATUS[call.status];
  const [a, b] = call.market.split(/[/-]/);
  const long = call.direction === "long";
  return (
    <article className={compact ? "" : "rounded-xl border border-line p-4"} aria-label={`${call.direction} call on ${call.market}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex -space-x-2"><TokenIcon symbol={a} size={26} /><TokenIcon symbol={b === "PERP" ? "USDC" : b ?? "USDC"} size={26} /></span>
        <h3 className="text-[16px] font-semibold">{call.market}</h3>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${long ? "bg-[#e6f6ec] text-gain" : "bg-[#fde8e8] text-loss"}`}>{long ? "▲ LONG" : "▼ SHORT"}</span>
        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
        {!call.traded && <span className="rounded-md px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-line" title="Idea only — no money behind it">paper</span>}
      </div>
      <dl className="num mt-3 grid grid-cols-3 gap-3 text-[14px]">
        {([["Entry", call.entry], ["Target", call.target], ["Stop", call.stop]] as const).map(([k, v]) => (
          <div key={k}>
            <dt className="font-sans text-[12px] text-muted">{k}</dt>
            <dd className="mt-0.5 font-semibold">{px(v)}</dd>
          </div>
        ))}
      </dl>
      {call.rMultiple !== undefined && (
        <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-[13px]">
          <span className="text-muted">R-multiple</span>
          <span className={`num font-semibold ${call.rMultiple >= 0 ? "text-gain" : "text-loss"}`}>{call.rMultiple >= 0 ? "▲ +" : "▼ −"}{num(Math.abs(call.rMultiple), 1)}R</span>
          <span className="ml-auto text-[12px] text-muted">Resolved from price data</span>
        </div>
      )}
    </article>
  );
}
