import Link from "next/link";
import type { ReactNode } from "react";
import { arrow, num, pct, signClass, usd } from "@/lib/format";
import { PROTOCOLS, RUNTIMES, VERIFICATION } from "@/lib/protocols";
import type { Agent, Metrics, ProtocolId, RuntimeId, Verification } from "@/lib/types";
import { AgentGlyph, ProtocolLogo } from "./glyphs";

/** Muted caption above a value. Sentence case, no tracking tricks. */
export const LABEL = "text-[13px] font-semibold text-muted";

/** A plain bordered panel. Used sparingly; most structure comes from rules and spacing. */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`min-w-0 rounded-lg border border-line bg-surface ${className}`}>{children}</section>;
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-[22px] font-extrabold leading-tight tracking-[-0.025em]">{children}</h2>
      {aside && <div className="text-[13px] text-muted">{aside}</div>}
    </div>
  );
}

export function RuntimeBadge({ runtime }: { runtime: RuntimeId }) {
  const r = RUNTIMES[runtime];
  return (
    <span title={r.note ?? r.label} className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-medium text-muted">
      <span aria-hidden className="size-2 rounded-[2px]" style={{ background: r.color }} />
      {r.label}
      {r.note && <span className="text-warn">(experimental)</span>}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.3" strokeWidth="1.6" />
      <path d="m5.2 8.2 2 2 3.6-4" />
    </svg>
  );
}

export function VerificationBadge({ level }: { level: Verification }) {
  const v = VERIFICATION[level];
  const tone = level === "attested" ? "text-gain" : level === "wallet_signed" ? "text-accent" : "text-muted";
  return (
    <span title={v.hint} className={`inline-flex items-center gap-1 whitespace-nowrap text-[12.5px] font-semibold ${tone}`}>
      {level === "declared" ? <span aria-hidden className="inline-block size-[13px] rounded-full border-[1.6px] border-current" /> : <CheckIcon />}
      {v.label}
    </span>
  );
}

export function EligibleChip({ eligible = true }: { eligible?: boolean }) {
  return eligible ? (
    <span className="whitespace-nowrap rounded bg-accent-soft px-1.5 py-px text-[11.5px] font-bold text-accent" title="Enough days and trades to be ranked">Ranked</span>
  ) : (
    <span className="whitespace-nowrap rounded bg-warn-bg px-1.5 py-px text-[11.5px] font-bold text-warn" title="Needs at least 7 days and 10 trades in this window">Not ranked yet</span>
  );
}

/** Why an agent cannot be ranked yet, when something other than history length is in the way. */
export function Blockers({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-[13.5px] leading-snug text-warn" aria-label="Why this agent is not ranked">
      {notes.map((n) => (<li key={n} className="flex gap-1.5"><span aria-hidden>▲</span><span>{n}</span></li>))}
    </ul>
  );
}

/** Shown whenever the 95% Sharpe range includes zero. */
export function LuckFlag({ m }: { m: Metrics }) {
  if (m.sharpeLo > 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-bold text-warn"
      title="The 95% range includes zero: with this little history the result is indistinguishable from luck."
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden fill="currentColor"><path d="M8 1.5 15 14H1L8 1.5Zm-.7 4.6v4h1.4v-4H7.3Zm0 5v1.4h1.4v-1.4H7.3Z" fillRule="evenodd" /></svg>
      Could be luck
    </span>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return <AgentGlyph name={name} size={size} />;
}

export function AgentChip({ agent, withBadges = true, size = 40 }: { agent: Agent; withBadges?: boolean; size?: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={agent.name} size={size} />
      <div className="min-w-0">
        <Link href={`/agents/${agent.slug}`} className="block truncate py-0.5 text-[16px] font-extrabold leading-tight tracking-[-0.015em] hover:underline">
          {agent.name}
        </Link>
        {withBadges && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
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
    <Link href={`/explore/${id}`} className="inline-flex items-center gap-1.5 text-[13px] font-semibold hover:underline">
      <ProtocolLogo id={id} size={16} />
      {p.name}
    </Link>
  );
}

/** Signed money value: colour + arrow + sign, never colour alone. */
export function Pnl({ value, bold = false, plain = false }: { value: number; bold?: boolean; plain?: boolean }) {
  return (
    <span className={`num ${signClass(value)} ${bold ? "font-bold" : ""}`}>
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
    <div title={hint}>
      <div className={LABEL}>{label}</div>
      <div className="num mt-1 text-[26px] font-extrabold leading-none tracking-[-0.02em]">{children}</div>
      {note && <div className="mt-1.5 text-[12px] leading-tight text-muted">{note}</div>}
    </div>
  );
}

/** Evidence next to a score, written out: "Range 0.7 to 15.0 from 62 trades over 30 days". */
export function SharpeLine({ m }: { m: Metrics }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
      <span className="num">Range {num(m.sharpeLo, 1)} to {num(m.sharpeHi, 1)}</span>
      <span className="num">{m.trades} trades over {m.days} days</span>
      <EligibleChip eligible={m.eligible} />
      <LuckFlag m={m} />
    </div>
  );
}

export function EvidenceBar({ m }: { m: Metrics; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 text-[13px] text-muted">
      <span className="num">{m.days} days live</span>
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

export function Empty({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="border-y border-dashed border-line px-2 py-12 text-center">
      {title && <h3 className="text-[18px] font-extrabold tracking-[-0.02em]">{title}</h3>}
      <div className="mx-auto mt-1 max-w-md text-[15px] text-muted">{children}</div>
    </div>
  );
}

/** A row of figures separated by rules rather than boxes. */
export function MetricStrip({ items, trailing }: { items: { label: ReactNode; value: ReactNode; sub?: ReactNode }[]; trailing?: ReactNode }) {
  return (
    <div className="border-y border-fg py-5">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:flex lg:gap-0">
        {items.map((it, i) => (
          <div key={i} className={`lg:flex-1 ${i > 0 ? "lg:border-l lg:border-line lg:pl-6" : ""}`}>
            <dt className={LABEL}>{it.label}</dt>
            <dd className="num mt-1.5 text-[30px] font-extrabold leading-none tracking-[-0.03em]">{it.value}</dd>
            {it.sub && <div className="num mt-1.5 text-[12.5px] text-muted">{it.sub}</div>}
          </div>
        ))}
      </dl>
      {trailing && <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">{trailing}</div>}
    </div>
  );
}

export function KpiStrip({ items }: { items: { label: string; value: ReactNode; sub?: ReactNode }[] }) {
  return <MetricStrip items={items} />;
}
