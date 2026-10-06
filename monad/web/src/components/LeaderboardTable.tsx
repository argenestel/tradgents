"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CHAIN_UI } from "@/lib/chain";
import { num, pct, signClass, usd } from "@/lib/format";
import { PROTOCOL_LIST, RUNTIMES } from "@/lib/protocols";
import type { LeaderboardRow, ProtocolId, RuntimeId, Tier, WindowKey } from "@/lib/types";
import { Sparkline } from "./charts";
import { ProtocolLogo } from "./glyphs";
import { AgentChip, Card, Disclaimer, EligibleChip, LuckFlag, Pct } from "./ui";

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All" },
];
const TIERS: Tier[] = ["<$250", "$250–2.5k", "$2.5k–25k", ">$25k"];
const sel = "rounded-xl border border-line bg-surface px-3 py-2 text-[14px] text-fg";

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  const [win, setWin] = useState<WindowKey>("30d");
  const [protocol, setProtocol] = useState<ProtocolId | "">("");
  const [runtime, setRuntime] = useState<RuntimeId | "">("");
  const [tier, setTier] = useState<Tier | "">("");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!protocol || r.agent.protocols.includes(protocol)) &&
          (!runtime || r.agent.runtime === runtime) &&
          (!tier || r.tier === tier) &&
          (!verifiedOnly || r.agent.verification !== "declared"),
      ),
    [rows, protocol, runtime, tier, verifiedOnly],
  );
  const ranked = useMemo(() => filtered.filter((r) => r.metrics[win].eligible).sort((a, b) => b.metrics[win].sharpe - a.metrics[win].sharpe), [filtered, win]);
  const young = filtered.filter((r) => !r.metrics[win].eligible);
  const showGas = CHAIN_UI.showGasColumn;

  return (
    <div>
      <div className="mb-6">
        <h1 className="display text-[44px] font-semibold leading-none">Leaderboard</h1>
        <p className="mt-2 text-[17px] text-muted">Ranked by Sharpe — with the uncertainty beside it.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="group" aria-label="Window">
          {WINDOWS.map((w) => (
            <button key={w.key} type="button" aria-pressed={win === w.key} onClick={() => setWin(w.key)} className={`rounded-lg px-4 py-1.5 text-[14px] font-medium ${win === w.key ? "bg-accent text-white" : "text-fg hover:bg-surface-2"}`}>
              {w.label}
            </button>
          ))}
        </div>
        <select aria-label="Protocol" className={sel} value={protocol} onChange={(e) => setProtocol(e.target.value as ProtocolId | "")}>
          <option value="">All protocols</option>
          {PROTOCOL_LIST.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <select aria-label="Runtime" className={sel} value={runtime} onChange={(e) => setRuntime(e.target.value as RuntimeId | "")}>
          <option value="">All runtimes</option>
          {(Object.keys(RUNTIMES) as RuntimeId[]).map((k) => (<option key={k} value={k}>{RUNTIMES[k].label}</option>))}
        </select>
        <select aria-label="Capital tier" className={sel} value={tier} onChange={(e) => setTier(e.target.value as Tier | "")}>
          <option value="">Any size</option>
          {TIERS.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
        <button type="button" aria-pressed={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)} className={`${sel} ${verifiedOnly ? "border-accent/50 bg-accent-soft text-accent" : ""}`}>
          {verifiedOnly ? "✓ " : ""}Verified only
        </button>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse">
          <caption className="sr-only">Agent leaderboard</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] font-medium text-muted">
              <th className="w-14 px-4 py-3 font-medium">#</th>
              <th className="px-3 py-3 font-medium">Agent</th>
              <th className="px-3 py-3 text-right font-medium">Sharpe · 95% range</th>
              <th className="px-3 py-3 text-right font-medium">Return</th>
              <th className="px-3 py-3 text-right font-medium" title={`Agent return minus ${CHAIN_UI.benchmark} buy-and-hold`}>vs {CHAIN_UI.benchmark}</th>
              <th className="px-3 py-3 text-right font-medium">Max DD</th>
              {showGas && <th className="px-3 py-3 text-right font-medium" title="Gas as a share of gross profit">Gas</th>}
              <th className="px-3 py-3 font-medium">Live</th>
              <th className="px-3 py-3 font-medium">Protocols</th>
              <th className="px-4 py-3 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, k) => {
              const m = r.metrics[win];
              return (
                <tr key={r.agent.slug} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                  <td className="num px-4 py-4 text-[16px] font-semibold text-muted">{String(k + 1).padStart(2, "0")}</td>
                  <td className="px-3 py-4"><AgentChip agent={r.agent} /></td>
                  <td className="px-3 py-4 text-right">
                    <div className="num text-[20px] font-semibold leading-none">{num(m.sharpe, 2)}</div>
                    <div className="num mt-1 text-[11.5px] text-muted">[{num(m.sharpeLo, 1)}, {num(m.sharpeHi, 1)}]</div>
                    <div className="mt-0.5 flex justify-end"><LuckFlag m={m} /></div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-4 text-right text-[14px]"><Pct value={m.returnPct} /></td>
                  <td className={`num whitespace-nowrap px-3 py-4 text-right text-[14px] ${signClass(m.excessPct)}`}>{m.excessPct >= 0 ? "▲ +" : "▼ −"}{pct(Math.abs(m.excessPct), { sign: false })}</td>
                  <td className="num whitespace-nowrap px-3 py-4 text-right text-[14px] text-loss">▼ {pct(m.maxDrawdownPct)}</td>
                  {showGas && <td className={`num px-3 py-4 text-right text-[14px] ${(r.gasPctOfGross ?? 0) > 5 ? "text-warn" : "text-muted"}`}>{pct(r.gasPctOfGross ?? 0)}</td>}
                  <td className="px-3 py-4">
                    <div className="num whitespace-nowrap text-[13px] text-muted">{m.days}d · {m.trades}</div>
                    <div className="mt-1"><EligibleChip eligible={m.eligible} /></div>
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex -space-x-1.5">{r.agent.protocols.slice(0, 4).map((p) => (<Link key={p} href={`/explore/${p}`} title={p}><span className="inline-block rounded-full ring-2 ring-white"><ProtocolLogo id={p} size={24} /></span></Link>))}</div>
                  </td>
                  <td className="px-4 py-4"><Link href={`/agents/${r.agent.slug}`} aria-label={`Open ${r.agent.name}`}><Sparkline values={r.spark} /></Link></td>
                </tr>
              );
            })}
            {ranked.length === 0 && (
              <tr><td colSpan={showGas ? 10 : 9} className="px-3 py-10 text-center text-muted">No eligible agents match.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {young.length > 0 && (
        <section className="mt-8" aria-label="Not yet ranked">
          <h2 className="display mb-3 text-[22px] font-semibold">Not ranked yet <span className="text-[14px] font-normal text-muted">— too little history</span></h2>
          <Card>
            <ul className="divide-y divide-line">
              {young.map((r) => (
                <li key={r.agent.slug} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 opacity-85">
                  <AgentChip agent={r.agent} />
                  <span className="num text-[13px] text-muted">{r.metrics[win].days}d · {r.metrics[win].trades} trades · {usd(r.equityUsd)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
      <Disclaimer className="mt-6 text-right" />
    </div>
  );
}
