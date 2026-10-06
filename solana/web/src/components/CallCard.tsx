import { num, usd } from "@/lib/format";
import type { Call } from "@/lib/types";
import { TokenIcon } from "./glyphs";

const STATUS: Record<Call["status"], { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-accent-soft text-accent" },
  hit: { label: "Hit target", cls: "bg-[#dff3e8] text-gain" },
  stopped: { label: "Stopped out", cls: "bg-[#fbe3e1] text-loss" },
  expired: { label: "Expired", cls: "bg-surface-2 text-muted" },
};

function px(n: number) {
  return n >= 100 ? usd(n) : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`;
}

/** Stop, entry and target on one line, so the risk and the reward are visible at a glance. */
function Gauge({ call }: { call: Call }) {
  const lo = Math.min(call.stop, call.target);
  const hi = Math.max(call.stop, call.target);
  const at = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const long = call.direction === "long";
  const entry = at(call.entry);
  const rewardFrom = long ? entry : at(call.target);
  const rewardTo = long ? at(call.target) : entry;
  const riskFrom = long ? at(call.stop) : entry;
  const riskTo = long ? entry : at(call.stop);
  return (
    <div className="mt-3" role="img" aria-label={`Stop ${px(call.stop)}, entry ${px(call.entry)}, target ${px(call.target)}`}>
      <div className="relative h-2.5 rounded-full bg-surface-2">
        <span aria-hidden className="absolute inset-y-0 rounded-l-full bg-[#f0b3ae]" style={{ left: `${riskFrom}%`, width: `${riskTo - riskFrom}%` }} />
        <span aria-hidden className="absolute inset-y-0 rounded-r-full bg-[#7fd1a8]" style={{ left: `${rewardFrom}%`, width: `${rewardTo - rewardFrom}%` }} />
        <span aria-hidden className="absolute top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg" style={{ left: `${entry}%` }} />
      </div>
      <div className="num mt-1.5 flex justify-between text-[12.5px] text-muted">
        {(long ? [["Stop", call.stop], ["Entry", call.entry], ["Target", call.target]] : [["Target", call.target], ["Entry", call.entry], ["Stop", call.stop]] as const).map(([k, v]) => (
          <span key={k as string}>{k as string} <b className="font-bold text-fg">{px(v as number)}</b></span>
        ))}
      </div>
    </div>
  );
}

export function CallCard({ call, compact = false }: { call: Call; compact?: boolean }) {
  const s = STATUS[call.status];
  const [a, b] = call.market.split(/[/-]/);
  const long = call.direction === "long";
  return (
    <article className={compact ? "" : "border-b border-line py-4"} aria-label={`${call.direction} call on ${call.market}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex -space-x-2"><TokenIcon symbol={a} size={24} /><TokenIcon symbol={b === "PERP" ? "USDC" : b ?? "USDC"} size={24} /></span>
        <h3 className="text-[17px] font-extrabold tracking-[-0.02em]">{call.market}</h3>
        <span className={`rounded px-1.5 py-px text-[12px] font-bold ${long ? "bg-[#dff3e8] text-gain" : "bg-[#fbe3e1] text-loss"}`}>{long ? "▲ Long" : "▼ Short"}</span>
        <span className={`rounded px-1.5 py-px text-[12px] font-bold ${s.cls}`}>{s.label}</span>
        {!call.traded && <span className="text-[12px] font-medium text-muted" title="An idea only. No money behind it.">Paper idea</span>}
        {call.rMultiple !== undefined && (
          <span className={`num ml-auto text-[14px] font-bold ${call.rMultiple >= 0 ? "text-gain" : "text-loss"}`}>{call.rMultiple >= 0 ? "▲ +" : "▼ −"}{num(Math.abs(call.rMultiple), 1)}R</span>
        )}
      </div>
      <Gauge call={call} />
    </article>
  );
}
