"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { CHAIN_UI } from "@/lib/chain";
import { num, pct, signClass, usd } from "@/lib/format";
import { PROTOCOL_LIST, RUNTIMES } from "@/lib/protocols";
import type { LeaderboardRow, Metrics, ProtocolId, RuntimeId, Tier, WindowKey } from "@/lib/types";
import { Sparkline } from "./charts";
import { ProtocolLogo } from "./glyphs";
import { Info } from "./Info";
import { AgentChip, Card, EligibleChip, LuckFlag, Pct } from "./ui";

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "all", label: "All" },
];
const TIERS: Tier[] = ["<$250", "$250–2.5k", "$2.5k–25k", ">$25k"];
const sel = "min-h-10 rounded-xl border border-line bg-surface px-3 py-2 text-[14px] text-fg";

type SortKey = "sharpe" | "return" | "excess" | "dd" | "live";
const SORTS: Record<SortKey, { label: string; get: (m: Metrics, r: LeaderboardRow) => number; defaultDir: "asc" | "desc" }> = {
  sharpe: { label: "Sharpe", get: (m) => m.sharpe, defaultDir: "desc" },
  return: { label: "Return", get: (m) => m.returnPct, defaultDir: "desc" },
  excess: { label: `vs ${CHAIN_UI.benchmark}`, get: (m) => m.excessPct, defaultDir: "desc" },
  dd: { label: "Max drawdown", get: (m) => m.maxDrawdownPct, defaultDir: "asc" },
  live: { label: "Days live", get: (m) => m.days, defaultDir: "desc" },
};

const isWin = (v: string | null): v is WindowKey => v === "7d" || v === "30d" || v === "all";
const isSort = (v: string | null): v is SortKey => !!v && v in SORTS;

function Th({ k, sortKey, dir, onSort, children, info, right = true }: { k: SortKey; sortKey: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; children: React.ReactNode; info?: React.ReactNode; right?: boolean }) {
  return (
    <th scope="col" aria-sort={sortKey === k ? (dir === "desc" ? "descending" : "ascending") : "none"} className={`px-3 py-3 font-medium ${right ? "text-right" : ""}`}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 rounded px-1 hover:text-fg ${sortKey === k ? "text-fg" : ""}`}>
        {children}
        <span aria-hidden className="text-[10px]">{sortKey === k ? (dir === "desc" ? "▼" : "▲") : "↕"}</span>
      </button>
      {info}
    </th>
  );
}

/** All filter/sort state lives in the URL so views are shareable and survive refresh. */
export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const win: WindowKey = isWin(sp.get("w")) ? (sp.get("w") as WindowKey) : "30d";
  const protocol = (sp.get("p") ?? "") as ProtocolId | "";
  const runtime = (sp.get("r") ?? "") as RuntimeId | "";
  const tier = (sp.get("t") ?? "") as Tier | "";
  const verifiedOnly = sp.get("v") === "1";
  const sortKey: SortKey = isSort(sp.get("s")) ? (sp.get("s") as SortKey) : "sharpe";
  const dir: "asc" | "desc" = sp.get("d") === "asc" || sp.get("d") === "desc" ? (sp.get("d") as "asc" | "desc") : SORTS[sortKey].defaultDir;

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }
  function sortBy(k: SortKey) {
    if (k === sortKey) set({ s: k, d: dir === "desc" ? "asc" : "desc" });
    else set({ s: k, d: SORTS[k].defaultDir });
  }

  const { ranked, young } = useMemo(() => {
    const f = rows.filter(
      (r) =>
        (!protocol || r.agent.protocols.includes(protocol)) &&
        (!runtime || r.agent.runtime === runtime) &&
        (!tier || r.tier === tier) &&
        (!verifiedOnly || r.agent.verification !== "declared"),
    );
    const get = SORTS[sortKey].get;
    const sorted = f.filter((r) => r.metrics[win].eligible).sort((a, b) => (dir === "desc" ? 1 : -1) * (get(b.metrics[win], b) - get(a.metrics[win], a)));
    return { ranked: sorted, young: f.filter((r) => !r.metrics[win].eligible) };
  }, [rows, protocol, runtime, tier, verifiedOnly, win, sortKey, dir]);

  const showGas = CHAIN_UI.showGasColumn;
  const filtersActive = !!(protocol || runtime || tier || verifiedOnly);

  return (
    <div>
      <div className="mb-6">
        <h1 className="display text-[36px] font-semibold leading-none sm:text-[44px]">Leaderboard</h1>
        <p className="mt-2 text-[16px] text-muted sm:text-[17px]">Ranked by Sharpe — with the uncertainty beside it.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div className="inline-flex rounded-xl border border-line bg-surface p-1" role="group" aria-label="Window">
          {WINDOWS.map((w) => (
            <button key={w.key} type="button" aria-pressed={win === w.key} onClick={() => set({ w: w.key === "30d" ? null : w.key })} className={`min-h-9 rounded-lg px-4 py-1.5 text-[14px] font-medium ${win === w.key ? "bg-accent text-white" : "text-fg hover:bg-surface-2"}`}>
              {w.label}
            </button>
          ))}
        </div>
        <select aria-label="Protocol" className={sel} value={protocol} onChange={(e) => set({ p: e.target.value })}>
          <option value="">All protocols</option>
          {PROTOCOL_LIST.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <select aria-label="Runtime" className={sel} value={runtime} onChange={(e) => set({ r: e.target.value })}>
          <option value="">All runtimes</option>
          {(Object.keys(RUNTIMES) as RuntimeId[]).map((k) => (<option key={k} value={k}>{RUNTIMES[k].label}</option>))}
        </select>
        <select aria-label="Capital tier" className={sel} value={tier} onChange={(e) => set({ t: e.target.value })}>
          <option value="">Any size</option>
          {TIERS.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
        <button type="button" aria-pressed={verifiedOnly} onClick={() => set({ v: verifiedOnly ? null : "1" })} className={`${sel} ${verifiedOnly ? "border-accent/50 bg-accent-soft text-accent" : ""}`}>
          {verifiedOnly ? "✓ " : ""}Verified only
        </button>
        {filtersActive && (
          <button type="button" onClick={() => set({ p: null, r: null, t: null, v: null })} className="min-h-10 px-2 text-[14px] font-medium text-accent hover:underline">Clear filters</button>
        )}
        <label className="ml-auto flex items-center gap-2 text-[13px] text-muted md:hidden">
          Sort
          <select aria-label="Sort by" className={sel} value={sortKey} onChange={(e) => set({ s: e.target.value, d: null })}>
            {(Object.keys(SORTS) as SortKey[]).map((k) => (<option key={k} value={k}>{SORTS[k].label}</option>))}
          </select>
        </label>
      </div>

      <p className="mb-2 text-[13px] text-muted" aria-live="polite">{ranked.length} ranked{young.length ? ` · ${young.length} not ranked yet` : ""}</p>

      {/* Phones: cards. */}
      <ul className="space-y-3 md:hidden">
        {ranked.map((r, k) => {
          const m = r.metrics[win];
          return (
            <li key={r.agent.slug}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="num pt-2 text-[14px] font-semibold text-muted">{String(k + 1).padStart(2, "0")}</span>
                    <AgentChip agent={r.agent} />
                  </div>
                  <div className="text-right">
                    <div className="num text-[24px] font-semibold leading-none">{num(m.sharpe, 2)}</div>
                    <div className="num mt-1 text-[11.5px] text-muted">[{num(m.sharpeLo, 1)}, {num(m.sharpeHi, 1)}]</div>
                  </div>
                </div>
                <div className="mt-2"><LuckFlag m={m} /></div>
                <dl className="num mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[13px]">
                  <div><dt className="font-sans text-[11.5px] text-muted">Return</dt><dd><Pct value={m.returnPct} /></dd></div>
                  <div><dt className="font-sans text-[11.5px] text-muted">vs {CHAIN_UI.benchmark}</dt><dd><Pct value={m.excessPct} /></dd></div>
                  <div><dt className="font-sans text-[11.5px] text-muted">Max DD</dt><dd className="text-loss">▼ {pct(m.maxDrawdownPct)}</dd></div>
                </dl>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="num text-[12px] text-muted">{m.days}d · {m.trades} trades</span>
                  <Link href={`/agents/${r.agent.slug}`} className="min-h-9 rounded-lg border border-accent/40 px-3 py-1.5 text-[13px] font-medium text-accent">View →</Link>
                </div>
              </Card>
            </li>
          );
        })}
        {ranked.length === 0 && <li className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-muted">No eligible agents match.</li>}
      </ul>

      {/* Tablet/desktop: sortable table. */}
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[880px] border-collapse">
          <caption className="sr-only">Agent leaderboard, sortable</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] font-medium text-muted">
              <th scope="col" className="w-14 px-4 py-3 font-medium">#</th>
              <th scope="col" className="px-3 py-3 font-medium">Agent</th>
              <Th k="sharpe" sortKey={sortKey} dir={dir} onSort={sortBy} info={<Info align="right" label="What is Sharpe?">Return per unit of risk. The bracket is a 95% range: if it includes 0, the result could be luck.</Info>}>
                Sharpe · 95% range
              </Th>
              <Th k="return" sortKey={sortKey} dir={dir} onSort={sortBy}>Return</Th>
              <Th k="excess" sortKey={sortKey} dir={dir} onSort={sortBy}>vs {CHAIN_UI.benchmark}</Th>
              <Th k="dd" sortKey={sortKey} dir={dir} onSort={sortBy}>Max DD</Th>
              {showGas && <th scope="col" className="px-3 py-3 text-right font-medium">Gas</th>}
              <Th k="live" sortKey={sortKey} dir={dir} onSort={sortBy} right={false}>Live</Th>
              <th scope="col" className="px-3 py-3 font-medium">Protocols</th>
              <th scope="col" className="px-4 py-3 font-medium">Trend</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r, k) => {
              const m = r.metrics[win];
              return (
                <tr key={r.agent.slug} className="border-b border-line transition-colors last:border-0 hover:bg-surface-2/70">
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
                    <div className="flex -space-x-1.5">{r.agent.protocols.slice(0, 4).map((p) => (<Link key={p} href={`/explore/${p}`} title={p} aria-label={p}><span className="inline-block rounded-full ring-2 ring-white"><ProtocolLogo id={p} size={24} /></span></Link>))}</div>
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
    </div>
  );
}
