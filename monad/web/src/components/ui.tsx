import Link from "next/link";
import type { ReactNode } from "react";
import { arrow, num, pct, signClass, usd } from "@/lib/format";
import { PROTOCOLS, RUNTIMES, VERIFICATION } from "@/lib/protocols";
import type { Agent, Metrics, ProtocolId, RuntimeId, Verification } from "@/lib/types";
import { AgentGlyph, ProtocolLogo } from "./glyphs";

/** Small muted caption used above values. */
export const LABEL = "text-[12px] font-medium text-muted";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-surface shadow-[var(--shadow)] ${className}`}>{children}</section>;
}

/** Serif section title with an optional muted caption — the design's heading pair. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="display text-[22px] font-semibold leading-tight">{children}</h2>
      {aside && <div className="text-[12px] text-muted">{aside}</div>}
    </div>
  );
}

const chip = "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-tight";

export function RuntimeBadge({ runtime }: { runtime: RuntimeId }) {
  const r = RUNTIMES[runtime];
  return (
    <span title={r.note ?? r.label} className={`${chip} bg-surface-2 text-muted ring-1 ring-line`}>
      {r.label}
      {r.note && <span className="text-warn">exp.</span>}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.2" strokeWidth="1.6" />
      <path d="m5.2 8.2 2 2 3.6-4" />
    </svg>
  );
}

export function VerificationBadge({ level }: { level: Verification }) {
  const v = VERIFICATION[level];
  if (level === "declared") {
    return (
      <span title={v.hint} className={`${chip} text-muted ring-1 ring-line`}>
        ○ {v.label}
      </span>
    );
  }
  return (
    <span title={v.hint} className={`${chip} bg-[#e6f6ec] text-gain`}>
      <CheckIcon />
      {v.label}
    </span>
  );
}

export function EligibleChip({ eligible = true }: { eligible?: boolean }) {
  return eligible ? (
    <span className={`${chip} bg-accent-soft text-accent`} title="Meets the minimum days and trades to be ranked">Eligible</span>
  ) : (
    <span className={`${chip} bg-warn-bg text-warn`} title="Needs at least 7 days and 10 trades in the window">Not ranked yet</span>
  );
}

/** Amber flag shown whenever the 95% Sharpe range includes zero. */
export function LuckFlag({ m }: { m: Metrics }) {
  if (m.sharpeLo > 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11.5px] font-medium text-warn"
      title="The 95% range includes zero: with this much history the result is indistinguishable from luck."
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden fill="currentColor"><path d="M8 1.5 15 14H1L8 1.5Zm-.7 4.6v4h1.4v-4H7.3Zm0 5v1.4h1.4v-1.4H7.3Z" fillRule="evenodd" /></svg>
      could be luck
    </span>
  );
}

/** Avatar = glyph disc. Kept as `Avatar` so callers don't change. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return <AgentGlyph name={name} size={size} />;
}

export function AgentChip({ agent, withBadges = true, size = 40 }: { agent: Agent; withBadges?: boolean; size?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={agent.name} size={size} />
      <div className="min-w-0">
        <Link href={`/agents/${agent.slug}`} className="block truncate text-[15px] font-semibold hover:underline">
          {agent.name}
        </Link>
        {withBadges && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <RuntimeBadge runtime={agent.runtime} />
            <VerificationBadge level={agent.verification} />
          </div>
        )}
      </div>
    </div>
  );
}

export function ProtocolChip({ id }: { id: ProtocolId }) {
  const p = PROTOCOLS[id];
  return (
    <Link href={`/explore/${id}`} className={`${chip} bg-accent-soft text-accent hover:brightness-95`}>
      <ProtocolLogo id={id} size={14} />
      {p.name}
    </Link>
  );
}

/** Signed money value: colour + arrow + sign, never colour alone. */
export function Pnl({ value, bold = false, plain = false }: { value: number; bold?: boolean; plain?: boolean }) {
  return (
    <span className={`num ${signClass(value)} ${bold ? "font-semibold" : ""}`}>
      {!plain && <span aria-hidden className="mr-1 text-[0.7em]">{arrow(value)}</span>}
      {usd(value, { sign: true })}
    </span>
  );
}

export function Pct({ value, digits = 1 }: { value: number; digits?: number }) {
  return (
    <span className={`num ${signClass(value)}`}>
      <span aria-hidden className="mr-1 text-[0.7em]">{arrow(value)}</span>
      {pct(value, { sign: true, digits })}
    </span>
  );
}

export function MetricTile({ label, children, note, hint }: { label: string; children: ReactNode; note?: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3.5 py-3" title={hint}>
      <div className={LABEL}>{label}</div>
      <div className="num mt-1 text-xl font-semibold leading-none">{children}</div>
      {note && <div className="mt-1.5 text-[11px] leading-tight text-muted">{note}</div>}
    </div>
  );
}

/**
 * One compact evidence line shown beside a score:
 * "Sharpe 2.4 · 95% [0.8, 4.0] · 96d · 312 trades · Eligible"
 */
export function SharpeLine({ m, label = true }: { m: Metrics; label?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted">
      {label && (
        <span>
          Sharpe <b className="num font-semibold text-fg">{num(m.sharpe, 1)}</b>
        </span>
      )}
      <span className="num">95% [{num(m.sharpeLo, 1)}, {num(m.sharpeHi, 1)}]</span>
      <span aria-hidden>·</span>
      <span className="num">{m.days}d · {m.trades} trades</span>
      <EligibleChip eligible={m.eligible} />
      <LuckFlag m={m} />
    </div>
  );
}

/** Kept for compatibility: evidence-only line. */
export function EvidenceBar({ m }: { m: Metrics; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
      <span className="num">{m.days}d live</span>
      <span aria-hidden>·</span>
      <span className="num">{m.trades} trades</span>
      <EligibleChip eligible={m.eligible} />
    </div>
  );
}

/** The global footer carries the disclaimer; kept as a no-op so pages needn't change. */
export function Disclaimer({ className }: { className?: string }) {
  void className;
  return null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">{children}</div>;
}

/** Horizontal metrics strip: one card, dividers between metrics, optional trailing note. */
export function MetricStrip({ items, trailing }: { items: { label: string; value: ReactNode; sub?: ReactNode }[]; trailing?: ReactNode }) {
  return (
    <Card className="grid grid-cols-2 gap-y-4 px-2 py-4 sm:grid-cols-3 lg:flex lg:items-stretch lg:gap-0 lg:py-4">
      {items.map((it, i) => (
        <div key={it.label} className={`px-4 ${i > 0 ? "lg:border-l lg:border-line" : ""}`}>
          <div className="text-[12px] font-medium text-muted">{it.label}</div>
          <div className="num mt-1.5 text-[22px] font-semibold leading-none">{it.value}</div>
          {it.sub && <div className="num mt-1.5 text-[11px] text-muted">{it.sub}</div>}
        </div>
      ))}
      {trailing && <div className="col-span-full flex items-center px-4 text-[12px] text-muted lg:ml-auto lg:border-l lg:border-line">{trailing}</div>}
    </Card>
  );
}

/** Kept for pages that still use the 4-up strip. */
export function KpiStrip({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label} className="px-4 py-3.5">
          <div className={LABEL}>{it.label}</div>
          <div className="num mt-1.5 text-2xl font-semibold leading-none">{it.value}</div>
          {it.sub && <div className="mt-1.5 text-[11px] text-muted">{it.sub}</div>}
        </Card>
      ))}
    </div>
  );
}
