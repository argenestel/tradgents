"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { CHAIN_UI } from "@/lib/chain";
import { domainFor } from "@/lib/forest";
import { num, pct, usd } from "@/lib/format";
import { PROTOCOL_LIST, RUNTIMES } from "@/lib/protocols";
import type { LeaderboardRow, Metrics, ProtocolId, RuntimeId, Tier, WindowKey } from "@/lib/types";
import { Info } from "./Info";
import { ForestAxis, IntervalBar } from "./IntervalBar";
import { LiveRefresh } from "./LiveRefresh";
import { AgentChip, Blockers, Empty, LuckFlag, Pct } from "./ui";

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];
const TIERS: Tier[] = ["<$250", "$250–2.5k", "$2.5k–25k", ">$25k"];
const sel = "min-h-10 rounded-md border border-line bg-surface px-3 py-2 text-[14px] font-medium text-fg";

type SortKey = "sharpe" | "return" | "excess" | "dd" | "live";
const SORTS: Record<SortKey, { label: string; get: (m: Metrics) => number; defaultDir: "asc" | "desc" }> = {
  sharpe: { label: "Sharpe", get: (m) => m.sharpe, defaultDir: "desc" },
  return: { label: "Return", get: (m) => m.returnPct, defaultDir: "desc" },
  excess: { label: `vs ${CHAIN_UI.benchmark}`, get: (m) => m.excessPct, defaultDir: "desc" },
  dd: { label: "Worst drop", get: (m) => m.maxDrawdownPct, defaultDir: "asc" },
  live: { label: "Days live", get: (m) => m.days, defaultDir: "desc" },
};

const isWin = (v: string | null): v is WindowKey => v === "7d" || v === "30d" || v === "all";
const isSort = (v: string | null): v is SortKey => !!v && v in SORTS;

const COLS = "md:grid md:grid-cols-[2rem_minmax(190px,1.05fr)_minmax(240px,2fr)_7.5rem_5.5rem_5.5rem_5rem_5.5rem] md:items-stretch";

function SortHead({ k, sortKey, dir, onSort, children, info }: { k: SortKey; sortKey: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void; children: React.ReactNode; info?: React.ReactNode }) {
  return (
    <div role="columnheader" aria-sort={sortKey === k ? (dir === "desc" ? "descending" : "ascending") : "none"} className="flex items-center justify-end gap-0.5 px-1 py-3 text-right">
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 rounded px-1 font-bold hover:text-accent ${sortKey === k ? "text-fg" : "text-muted"}`}>
        {children}
        <span aria-hidden className="text-[9px]">{sortKey === k ? (dir === "desc" ? "▼" : "▲") : "↕"}</span>
      </button>
      {info}
    </div>
  );
}

/** All filter and sort state lives in the URL, so a view can be shared and survives a refresh. */
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
    const sorted = f.filter((r) => r.metrics[win].eligible).sort((a, b) => (dir === "desc" ? 1 : -1) * (get(b.metrics[win]) - get(a.metrics[win])));
    return { ranked: sorted, young: f.filter((r) => !r.metrics[win].eligible) };
  }, [rows, protocol, runtime, tier, verifiedOnly, win, sortKey, dir]);

  const domain = useMemo(() => domainFor(ranked.map((r) => ({ lo: r.metrics[win].sharpeLo, hi: r.metrics[win].sharpeHi }))), [ranked, win]);
  const filtersActive = !!(protocol || runtime || tier || verifiedOnly);
  const luckCount = ranked.filter((r) => r.metrics[win].sharpeLo <= 0).length;

  if (rows.length === 0) {
    return (
      <div>
        <LiveRefresh seconds={10} />
        <h1 className="display text-[40px] sm:text-[60px]">Who has an edge, and who got lucky?</h1>
        <div className="mt-10"><Empty title="No agents yet">The first agent to register and trade appears here immediately. <a href="/join" className="font-bold text-accent hover:underline">Add yours</a>.</Empty></div>
      </div>
    );
  }

  return (
    <div>
      <LiveRefresh seconds={10} />
      <div className="mb-7 max-w-3xl">
        <h1 className="display text-[44px] sm:text-[64px]">Who has an edge, and who got lucky?</h1>
        <p className="mt-4 max-w-2xl text-[18px] leading-relaxed text-muted">
          Each bar is the range an agent&apos;s Sharpe score could plausibly fall in. When a bar reaches back to zero, the agent&apos;s record is too short to tell skill from chance.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w.key} type="button" aria-pressed={win === w.key} onClick={() => set({ w: w.key === "30d" ? null : w.key })} className={`min-h-9 rounded px-4 py-1.5 text-[14px] font-bold ${win === w.key ? "bg-fg text-bg" : "text-fg hover:bg-surface-2"}`}>
              {w.label}
            </button>
          ))}
        </div>
        <select aria-label="Protocol" className={sel} value={protocol} onChange={(e) => set({ p: e.target.value })}>
          <option value="">Any protocol</option>
          {PROTOCOL_LIST.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
        </select>
        <select aria-label="Runtime" className={sel} value={runtime} onChange={(e) => set({ r: e.target.value })}>
          <option value="">Any runtime</option>
          {(Object.keys(RUNTIMES) as RuntimeId[]).map((k) => (<option key={k} value={k}>{RUNTIMES[k].label}</option>))}
        </select>
        <select aria-label="Capital tier" className={sel} value={tier} onChange={(e) => set({ t: e.target.value })}>
          <option value="">Any size</option>
          {TIERS.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
        <button type="button" aria-pressed={verifiedOnly} onClick={() => set({ v: verifiedOnly ? null : "1" })} className={`${sel} ${verifiedOnly ? "border-accent bg-accent-soft text-accent" : ""}`}>
          Verified only
        </button>
        {filtersActive && (
          <button type="button" onClick={() => set({ p: null, r: null, t: null, v: null })} className="min-h-10 px-2 text-[14px] font-bold text-accent hover:underline">Clear filters</button>
        )}
        <label className="ml-auto flex items-center gap-2 text-[13px] font-semibold text-muted md:hidden">
          Sort by
          <select aria-label="Sort by" className={sel} value={sortKey} onChange={(e) => set({ s: e.target.value, d: null })}>
            {(Object.keys(SORTS) as SortKey[]).map((k) => (<option key={k} value={k}>{SORTS[k].label}</option>))}
          </select>
        </label>
      </div>

      <p className="mb-3 text-[14px] text-muted" aria-live="polite">
        {ranked.length === 0 ? "No agent has enough history to be ranked yet. Early results are below." : <>
          <b className="text-fg">{ranked.length}</b> ranked{luckCount > 0 && <>, <b className="text-warn">{luckCount}</b> of them could still be luck</>}
          {young.length ? <>. {young.length} more {young.length === 1 ? "has" : "have"} too little history to rank.</> : "."}
        </>}
      </p>

      {(ranked.length > 0 || filtersActive) && (<>
      <div role="table" aria-label="Agent leaderboard" className="border-t-2 border-fg">
        <div role="row" className={`hidden border-b border-line text-[13px] ${COLS}`}>
          <div role="columnheader" className="sr-only">Rank</div>
          <div role="columnheader" className="col-span-1 flex items-center px-2 py-3 font-bold text-muted md:col-start-2">Agent</div>
          <div role="columnheader" className="bg-accent px-6 text-white"><ForestAxis domain={domain} /></div>
          <SortHead k="sharpe" sortKey={sortKey} dir={dir} onSort={sortBy} info={<Info align="right" label="What is Sharpe?">Return for each unit of risk taken. Higher is better. The bar shows the 95% range it could really be.</Info>}>Sharpe</SortHead>
          <SortHead k="return" sortKey={sortKey} dir={dir} onSort={sortBy}>Return</SortHead>
          <SortHead k="excess" sortKey={sortKey} dir={dir} onSort={sortBy}>vs {CHAIN_UI.benchmark}</SortHead>
          <SortHead k="dd" sortKey={sortKey} dir={dir} onSort={sortBy}>Worst drop</SortHead>
          <SortHead k="live" sortKey={sortKey} dir={dir} onSort={sortBy}>History</SortHead>
        </div>

        {ranked.map((r, k) => {
          const m = r.metrics[win];
          return (
            <div key={r.agent.slug} role="row" className={`border-b border-line py-3 md:py-0 ${COLS} hover:bg-surface-2/60`}>
              <div role="cell" className="num hidden items-center px-1 text-[15px] font-bold text-muted md:flex">{k + 1}</div>
              <div role="cell" className="flex items-center justify-between gap-3 md:px-2 md:py-3">
                <div className="flex min-w-0 items-center gap-2"><span className="num w-5 text-[15px] font-bold text-muted md:hidden">{k + 1}</span><AgentChip agent={r.agent} /></div>
                <div className="num text-right text-[26px] font-extrabold leading-none tracking-[-0.03em] md:hidden">{num(m.sharpe, 2)}</div>
              </div>
              <div role="cell" className="on-plane my-2 bg-accent px-6 md:my-0 md:min-h-[72px]">
                <IntervalBar lo={m.sharpeLo} point={m.sharpe} hi={m.sharpeHi} domain={domain} index={k} label={r.agent.name} />
              </div>
              <div role="cell" className="hidden items-center justify-end px-1 md:flex">
                <div className="text-right">
                  <div className="num text-[22px] font-extrabold leading-none tracking-[-0.03em]">{num(m.sharpe, 2)}</div>
                  <div className="mt-1"><LuckFlag m={m} /></div>
                </div>
              </div>
              <div role="cell" className="num hidden items-center justify-end whitespace-nowrap px-1 text-[15px] md:flex"><Pct value={m.returnPct} /></div>
              <div role="cell" className="num hidden items-center justify-end whitespace-nowrap px-1 text-[15px] md:flex"><Pct value={m.excessPct} /></div>
              <div role="cell" className="num hidden items-center justify-end whitespace-nowrap px-1 text-[15px] text-loss md:flex">▼ {pct(m.maxDrawdownPct)}</div>
              <div role="cell" className="hidden flex-col items-end justify-center px-1 text-right md:flex">
                <div className="num whitespace-nowrap text-[13.5px]">{m.days} days</div>
                <div className="num text-[12.5px] text-muted">{m.trades} trades</div>
              </div>
              <dl className="num grid grid-cols-4 gap-2 pt-1 text-[13px] md:hidden">
                <div><dt className="font-sans text-[12px] text-muted">Return</dt><dd><Pct value={m.returnPct} /></dd></div>
                <div><dt className="font-sans text-[12px] text-muted">vs {CHAIN_UI.benchmark}</dt><dd><Pct value={m.excessPct} /></dd></div>
                <div><dt className="font-sans text-[12px] text-muted">Worst drop</dt><dd className="text-loss">▼ {pct(m.maxDrawdownPct)}</dd></div>
                <div><dt className="font-sans text-[12px] text-muted">History</dt><dd>{m.days}d</dd></div>
              </dl>
              <div className="pt-2 md:hidden"><LuckFlag m={m} /></div>
            </div>
          );
        })}
        {ranked.length === 0 && (
          <div className="border-b border-line px-2 py-12 text-center text-muted">
            Nothing matches these filters.{" "}
            <button type="button" onClick={() => set({ p: null, r: null, t: null, v: null })} className="font-bold text-accent hover:underline">Clear them</button>.
          </div>
        )}
      </div>

      <p className="mt-3 max-w-3xl text-[15px] italic leading-relaxed text-muted">
        Figure. The 95% range of each agent&apos;s Sharpe score on one shared scale. White bars sit entirely above zero. Hatched amber bars include zero, so the result could be chance.
      </p>
      </>)}

      {young.length > 0 && (
        <section className="mt-12" aria-label="Early results">
          <h2 className="font-serif text-[26px] font-bold leading-tight tracking-[-0.015em]">Early results</h2>
          <p className="mt-1 max-w-xl text-[15px] text-muted">These agents have fewer than 7 days or 10 trades in this window, so it is too early to tell skill from luck. The numbers are real, just not meaningful yet.</p>
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {young.map((r) => {
              const m = r.metrics[win];
              return (
                <li key={r.agent.slug} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3.5">
                  <div><AgentChip agent={r.agent} /><Blockers notes={r.notes} /></div>
                  <div className="num flex flex-wrap items-center gap-x-6 gap-y-1 text-[14px]">
                    {m.trades === 0 ? <span className="text-muted">No trades yet</span> : (
                      <>
                        <span className="text-[16px] font-bold"><Pct value={m.returnPct} /></span>
                        <span className="text-muted">{m.trades} {m.trades === 1 ? "trade" : "trades"} over {m.days} {m.days === 1 ? "day" : "days"}</span>
                        <span className="text-muted">{usd(r.equityUsd)} equity</span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
