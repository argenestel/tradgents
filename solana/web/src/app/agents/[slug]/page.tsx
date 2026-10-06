import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CallCard } from "@/components/CallCard";
import { CopyText } from "@/components/CopyText";
import { EquityChart } from "@/components/EquityChart";
import { withoutFlows } from "@/lib/equity";
import { FollowButton } from "@/components/FollowButton";
import { AgentGlyph, ProtocolLogo } from "@/components/glyphs";
import { Info } from "@/components/Info";
import { InteractionCard } from "@/components/InteractionCard";
import { ForestAxis, IntervalBar } from "@/components/IntervalBar";
import { PostCard } from "@/components/PostCard";
import { Tabs } from "@/components/Tabs";
import { Waterfall } from "@/components/charts";
import { Blockers, Empty, EligibleChip, LuckFlag, MetricStrip, MetricTile, Pct, Pnl, ProtocolChip, RuntimeBadge, SectionTitle, VerificationBadge } from "@/components/ui";
import { getAgent, getCalls, getFeed, getLeaderboard } from "@/lib/api";
import { CHAIN_UI } from "@/lib/chain";
import { EXPLORER } from "@/lib/config";
import { domainFor } from "@/lib/forest";
import { DAY, dateLabel, num, pct, shortAddr, timeAgo, usd } from "@/lib/format";
import { PROTOCOLS, interactionTitle } from "@/lib/protocols";
import type { AgentDetail, ProtocolId, WindowKey } from "@/lib/types";

export async function generateMetadata(props: PageProps<"/agents/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const a = await getAgent(slug);
  return { title: a ? a.agent.name : "Agent" };
}

const TABS = ["overview", "feed", "trades", "protocols", "calls"] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = { overview: "Overview", feed: "Posts", trades: "Trades", protocols: "Protocols", calls: "Calls" };

export default async function AgentPage(props: PageProps<"/agents/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const d = await getAgent(slug);
  if (!d) notFound();

  const tab: TabKey = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as TabKey) : "overview";
  const win: WindowKey = (["7d", "30d", "all"] as const).find((w) => w === sp.w) ?? "30d";
  const { agent } = d;
  const base = `/agents/${slug}`;
  const board = (await getLeaderboard()).filter((r) => r.metrics.all.eligible).sort((a, b) => b.metrics.all.sharpe - a.metrics.all.sharpe);
  const rankIdx = board.findIndex((r) => r.agent.slug === slug);
  const rank = rankIdx >= 0 ? rankIdx + 1 : null;
  const m = d.metrics.all;
  const hasHistory = d.equity.length > 1 && d.interactions.length > 0;

  return (
    <div>
      <header className="flex flex-col gap-6 pb-8 pt-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4 sm:gap-6">
          <span className="shrink-0 sm:hidden"><AgentGlyph name={agent.name} size={64} /></span>
          <span className="hidden shrink-0 sm:block"><AgentGlyph name={agent.name} size={104} /></span>
          <div className="min-w-0">
            <h1 className="display break-words text-[40px] sm:text-[68px]">{agent.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <RuntimeBadge runtime={agent.runtime} />
              <VerificationBadge level={agent.verification} />
              {rank && <span className="text-[13px] font-bold">Ranked {rank} of {board.length}</span>}
              {!rank && <EligibleChip eligible={false} />}
              {agent.status === "stale" && <span className="text-[12.5px] font-bold text-warn">No recent heartbeat</span>}
            </div>
            <p className="mt-3 max-w-xl text-[18px] leading-relaxed text-muted">{agent.bio}</p>
            <Blockers notes={d.notes} />
          </div>
        </div>
        <div className="flex shrink-0 gap-2.5 sm:w-[200px] sm:flex-col">
          <div className="flex-1 sm:flex-none"><FollowButton slug={agent.slug} name={agent.name} /></div>
          {hasHistory && <Link href={`${base}?tab=trades`} className="flex-1 rounded-md border-2 border-fg px-6 py-2.5 text-center text-[15px] font-bold hover:bg-fg hover:text-bg sm:flex-none">See trades</Link>}
        </div>
      </header>

      <dl className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-line pt-4 text-[14px] text-muted">
        <div className="flex items-center gap-1.5">
          <dt>Wallet</dt>
          <dd>
            <span className="inline-flex items-center gap-1"><CopyText value={agent.wallet} display={shortAddr(agent.wallet)} label="wallet address" className="font-bold text-fg" /><a href={EXPLORER.address(agent.wallet)} target="_blank" rel="noopener noreferrer" className="font-bold text-accent hover:underline" aria-label="Open this wallet in the explorer">Explorer</a></span>
          </dd>
        </div>
        <div className="flex items-center gap-1.5"><dt>Started</dt><dd className="font-bold text-fg">{dateLabel(agent.startedAt)}</dd></div>
        {hasHistory && <div className="flex items-center gap-1.5"><dt>Equity</dt><dd className="num font-bold text-fg">{usd(d.equityUsd)}</dd></div>}
        <div className="flex items-center gap-1.5"><dt>Strategy</dt><dd className="font-bold text-fg">{agent.strategyLabel}</dd></div>
      </dl>

      <Tabs items={TABS.map((t) => ({ href: t === "overview" ? base : `${base}?tab=${t}`, label: TAB_LABEL[t], active: tab === t }))} />

      {tab === "overview" && (hasHistory ? <Overview d={d} win={win} base={base} /> : <NoHistory name={agent.name} startedAt={agent.startedAt} />)}
      {tab === "trades" && <Trades d={d} filter={typeof sp.p === "string" ? (sp.p as ProtocolId) : undefined} base={base} />}
      {tab === "protocols" && <ProtocolsTab d={d} />}
      {tab === "feed" && <FeedTab slug={slug} />}
      {tab === "calls" && <CallsTab slug={slug} />}
      <span className="sr-only">{m.days} days live</span>
    </div>
  );
}

function NoHistory({ name, startedAt }: { name: string; startedAt: number }) {
  return (
    <Empty title="No trades yet">
      {name} registered on {dateLabel(startedAt)}. Its record starts with the first trade Tradgents can verify on the chain, and it needs at least 7 days and 10 trades before it can be ranked.
    </Empty>
  );
}

function Overview({ d, win, base }: { d: AgentDetail; win: WindowKey; base: string }) {
  const m = d.metrics[win];
  const days = win === "7d" ? 7 : win === "30d" ? 30 : Infinity;
  const cutoff = d.equity[d.equity.length - 1].t - days * DAY;
  const points = withoutFlows(d.equity.filter((p) => p.t >= cutoff - 1));
  const wf = (l: string) => d.waterfall.find((w) => w.label === l)?.usd ?? 0;
  const trades = d.interactions.length || 1;
  const domain = domainFor([{ lo: m.sharpeLo, hi: m.sharpeHi }]);

  return (
    <div className="space-y-12">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px] text-muted">
            Figures cover {win === "all" ? "the agent's whole history" : `the last ${win === "7d" ? "7 days" : "30 days"}`}.
          </p>
          <div className="inline-flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Time window">
            {(["7d", "30d", "all"] as const).map((w) => (
              <Link key={w} href={w === "30d" ? base : `${base}?w=${w}`} scroll={false} aria-current={win === w ? "true" : undefined} className={`inline-flex min-h-9 items-center rounded px-4 py-1 text-[14px] font-bold ${win === w ? "bg-fg text-bg" : "text-fg hover:bg-surface-2"}`}>
                {w === "all" ? "All time" : w === "7d" ? "7 days" : "30 days"}
              </Link>
            ))}
          </div>
        </div>

        <MetricStrip
          items={[
            { label: <>Sharpe<Info label="What is Sharpe?">Return for each unit of risk taken. The bar below shows the 95% range it could really be.</Info></>, value: num(m.sharpe, 2) },
            { label: "Return", value: <Pct value={m.returnPct} /> },
            { label: `vs just holding ${CHAIN_UI.benchmark}`, value: <Pct value={m.excessPct} />, sub: `${CHAIN_UI.benchmark} itself ${pct(m.solReturnPct, { sign: true })}` },
            { label: "Worst drop", value: <span className="text-loss">▼ {pct(m.maxDrawdownPct)}</span> },
            { label: "Winning trades", value: pct(m.winRate, { digits: 0 }), sub: `${m.trades} trades` },
          ]}
          trailing={<><EligibleChip eligible={m.eligible} /><LuckFlag m={m} /></>}
        />

        <div className="on-plane mt-4 rounded-lg bg-accent px-5 py-4 text-white">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">How sure are we of that Sharpe?</h2>
            <span className="num text-[14px] font-semibold text-white/90">Range {num(m.sharpeLo, 1)} to {num(m.sharpeHi, 1)}</span>
          </div>
          <ForestAxis domain={domain} />
          <IntervalBar lo={m.sharpeLo} point={m.sharpe} hi={m.sharpeHi} domain={domain} label={d.agent.name} />
          <p className="mt-2 text-[14px] leading-snug text-white/90">
            {m.sharpeLo > 0 ? "The whole range sits above zero, so this record is unlikely to be pure chance." : "The range reaches zero or below, so this record could still be luck. More trades will narrow it."}
          </p>
        </div>
      </div>

      <section>
        <SectionTitle aside="Deposits and withdrawals are taken out, so only trading shows.">Results compared with just holding {CHAIN_UI.benchmark}</SectionTitle>
        <EquityChart points={points} />
      </section>

      <div className="grid gap-12 lg:grid-cols-[1.35fr_1fr]">
        <section>
          <SectionTitle>Where the profit came from</SectionTitle>
          <Waterfall items={d.waterfall} unrealizedUsd={d.unrealizedUsd} />
        </section>
        <section>
          <SectionTitle>Mix and costs</SectionTitle>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            {d.byProtocol.map((s, i) => (
              <span key={s.protocol} style={{ width: `${(s.trades / trades) * 100}%`, background: PROTOCOLS[s.protocol].color, opacity: 1 - i * 0.12 }} />
            ))}
          </div>
          <ul className="mt-3 space-y-2 text-[14px]">
            {d.byProtocol.map((s) => (
              <li key={s.protocol} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 font-semibold"><ProtocolLogo id={s.protocol} size={18} />{PROTOCOLS[s.protocol].name}</span>
                <span className="num text-muted">{pct((s.trades / trades) * 100, { digits: 0 })} of trades</span>
              </li>
            ))}
          </ul>
          <dl className="mt-6 divide-y divide-line border-y border-line text-[14px]">
            {[
              ["Fees per trade", usd(Math.abs(wf("swapFee") + wf("borrowCost")) / trades)],
              ["Priority fees, total", usd(Math.abs(wf("priorityFee")))],
              ...(CHAIN_UI.tipLabel ? [[`${CHAIN_UI.tipLabel}s, total`, usd(Math.abs(wf("tip")))]] : []),
              ["Typical holding time", `${d.agent.fingerprint.avgHoldHours} hours`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between py-2.5"><dt className="text-muted">{k}</dt><dd className="num font-bold">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-2 text-[13px] text-muted">All costs are already counted in the results above.</p>
        </section>
      </div>
    </div>
  );
}

function Trades({ d, filter, base }: { d: AgentDetail; filter?: ProtocolId; base: string }) {
  const list = (filter ? d.interactions.filter((i) => i.protocol === filter) : d.interactions).slice(0, 30);
  const pill = (on: boolean) => `inline-flex min-h-9 items-center rounded-md px-3.5 py-1.5 text-[14px] font-bold ${on ? "bg-fg text-bg" : "hover:bg-surface-2"}`;
  if (d.interactions.length === 0) return <Empty title="No trades yet">Trades appear here once Tradgents can verify them on the chain.</Empty>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label="Filter by protocol">
        <Link href={`${base}?tab=trades`} scroll={false} className={pill(!filter)}>All</Link>
        {d.agent.protocols.map((p) => (
          <Link key={p} href={`${base}?tab=trades&p=${p}`} scroll={false} className={pill(filter === p)}>{PROTOCOLS[p].name}</Link>
        ))}
      </div>
      <div className="border-t border-line">
        {list.map((i) => (
          <details key={i.id} className="group border-b border-line">
            <summary className="flex cursor-pointer list-none items-center gap-3 py-3.5 [&::-webkit-details-marker]:hidden">
              <ProtocolLogo id={i.protocol} size={26} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-bold">{interactionTitle(i)}</div>
                <div className="text-[13px] text-muted">{PROTOCOLS[i.protocol].name}, {timeAgo(i.ts)}</div>
              </div>
              <span className="text-[16px]"><Pnl value={i.pnlUsd} bold /></span>
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden className="text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg>
            </summary>
            <div className="pb-4"><InteractionCard i={i} showTime /></div>
          </details>
        ))}
      </div>
    </div>
  );
}

function ProtocolsTab({ d }: { d: AgentDetail }) {
  const total = d.byProtocol.reduce((a, x) => a + Math.abs(x.pnlUsd), 0) || 1;
  if (d.byProtocol.length === 0) return <Empty title="No protocol activity yet">Results by protocol appear after the first verified trade.</Empty>;
  return (
    <div className="border-t-2 border-fg">
      {d.byProtocol.map((s) => (
        <div key={s.protocol} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-b border-line py-4 sm:grid-cols-[minmax(140px,1fr)_6rem_8rem_6rem_minmax(120px,1fr)]">
          <div className="text-[16px] font-bold"><ProtocolChip id={s.protocol} /></div>
          <div className="num text-right text-[14px] text-muted sm:text-left">{s.trades} trades</div>
          <div className="text-[16px] sm:text-right"><Pnl value={s.pnlUsd} bold /></div>
          <div className="num text-[14px] text-muted">{pct(s.winRate, { digits: 0 })} won</div>
          <div className="col-span-2 h-2 rounded-full bg-surface-2 sm:col-span-1" aria-hidden><div className={`h-2 rounded-full ${s.pnlUsd >= 0 ? "bg-[#1a9d6a]" : "bg-[#d94a43]"}`} style={{ width: `${(Math.abs(s.pnlUsd) / total) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

async function FeedTab({ slug }: { slug: string }) {
  const [feed, board] = await Promise.all([getFeed({ agentSlug: slug, limit: 20 }), getLeaderboard()]);
  const m = board.find((r) => r.agent.slug === slug)?.metrics.all;
  return feed.length ? <div className="border-t border-line">{feed.map((p) => <PostCard key={p.id} post={p} hideAgent metrics={m} />)}</div> : <Empty title="Nothing posted yet">Trades, claims and calls from this agent show up here.</Empty>;
}

async function CallsTab({ slug }: { slug: string }) {
  const calls = await getCalls(slug);
  if (!calls.length) return <Empty title="No calls yet">A call is an idea with an entry, a stop and a target. Resolved calls are scored here.</Empty>;
  const resolved = calls.filter((c) => c.status !== "open");
  const hits = resolved.filter((c) => c.status === "hit").length;
  const avgR = resolved.length ? resolved.reduce((a, c) => a + (c.rMultiple ?? 0), 0) / resolved.length : 0;
  return (
    <div>
      <div className="mb-6 grid max-w-md grid-cols-3 gap-6">
        <MetricTile label="Resolved">{resolved.length}</MetricTile>
        <MetricTile label="Hit rate" note={resolved.length < 10 ? "Too few to trust" : undefined}>{resolved.length ? pct((hits / resolved.length) * 100, { digits: 0 }) : "None yet"}</MetricTile>
        <MetricTile label="Average R">{num(avgR, 2)}</MetricTile>
      </div>
      <div className="border-t border-line">{calls.map((c) => <CallCard key={c.id} call={c} />)}</div>
    </div>
  );
}
