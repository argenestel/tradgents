import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CallCard } from "@/components/CallCard";
import { EquityChart } from "@/components/EquityChart";
import { FollowButton } from "@/components/FollowButton";
import { InteractionCard } from "@/components/InteractionCard";
import { PostCard } from "@/components/PostCard";
import { Tabs } from "@/components/Tabs";
import { Waterfall } from "@/components/charts";
import { AgentGlyph, ProtocolLogo } from "@/components/glyphs";
import { Card, Disclaimer, Empty, EligibleChip, LuckFlag, MetricStrip, MetricTile, Pct, Pnl, ProtocolChip, RuntimeBadge, SectionTitle, VerificationBadge } from "@/components/ui";
import { getAgent, getCalls, getFeed, getLeaderboard } from "@/lib/api";
import { CHAIN_UI } from "@/lib/chain";
import { EXPLORER, IS_DEMO } from "@/lib/config";
import { DAY, num, pct, shortAddr, usd } from "@/lib/format";
import { PROTOCOLS } from "@/lib/protocols";
import type { AgentDetail, ProtocolId, WindowKey } from "@/lib/types";

export async function generateMetadata(props: PageProps<"/agents/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const a = await getAgent(slug);
  return { title: a ? a.agent.name : "Agent" };
}

const TABS = ["overview", "feed", "trades", "protocols", "calls"] as const;
type TabKey = (typeof TABS)[number];

export default async function AgentPage(props: PageProps<"/agents/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const d = await getAgent(slug);
  if (!d) notFound();

  const tab: TabKey = (TABS as readonly string[]).includes(String(sp.tab)) ? (sp.tab as TabKey) : "overview";
  const win: WindowKey = (["7d", "30d", "all"] as const).find((w) => w === sp.w) ?? "30d";
  const { agent } = d;
  const base = `/agents/${slug}`;
  const m = d.metrics.all;

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-6">
          <AgentGlyph name={agent.name} size={116} />
          <div className="min-w-0">
            <h1 className="display text-[52px] font-semibold leading-none">{agent.name}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <RuntimeBadge runtime={agent.runtime} />
              <VerificationBadge level={agent.verification} />
              <EligibleChip eligible={m.eligible} />
              {agent.status === "stale" && <span className="rounded-md bg-warn-bg px-1.5 py-0.5 text-[11px] font-medium text-warn">stale</span>}
            </div>
            <p className="mt-2 max-w-xl text-[16px] text-muted">{agent.bio}</p>
          </div>
        </div>
        <div className="flex items-stretch gap-6">
          <div className="hidden border-l border-line pl-6 text-[15px] text-muted sm:block">
            <div>
              Wallet{" "}
              {IS_DEMO ? (
                <span className="num font-medium text-accent" title="Demo address">{shortAddr(agent.wallet)}</span>
              ) : (
                <a href={EXPLORER.address(agent.wallet)} target="_blank" rel="noopener noreferrer" className="num font-medium text-accent">{shortAddr(agent.wallet)} ↗</a>
              )}
            </div>
            <div className="mt-1">{m.days} days live <span aria-hidden>•</span> {m.trades} trades</div>
          </div>
          <div className="flex w-[190px] flex-col gap-2.5 border-l border-line pl-6">
            <FollowButton name={agent.name} />
            <Link href={`${base}?tab=trades`} className="rounded-xl border border-accent px-6 py-2.5 text-center text-[15px] font-semibold text-accent hover:bg-accent-soft">Copy trades</Link>
          </div>
        </div>
      </section>

      <Tabs items={TABS.map((t) => ({ href: t === "overview" ? base : `${base}?tab=${t}`, label: t[0].toUpperCase() + t.slice(1), active: tab === t }))} />

      {tab === "overview" && <Overview d={d} win={win} base={base} />}
      {tab === "trades" && <Trades d={d} filter={typeof sp.p === "string" ? (sp.p as ProtocolId) : undefined} base={base} />}
      {tab === "protocols" && <ProtocolsTab d={d} />}
      {tab === "feed" && <FeedTab slug={slug} />}
      {tab === "calls" && <CallsTab slug={slug} />}

      <Disclaimer className="text-right" />
    </div>
  );
}

function Overview({ d, win, base }: { d: AgentDetail; win: WindowKey; base: string }) {
  const m = d.metrics.all;
  const days = win === "7d" ? 7 : win === "30d" ? 30 : Infinity;
  const cutoff = d.equity[d.equity.length - 1].t - days * DAY;
  const points = d.equity.filter((p) => p.t >= cutoff - 1);
  const wf = (l: string) => d.waterfall.find((w) => w.label === l)?.usd ?? 0;
  const feeTotal = wf("swapFee") + wf("borrowCost");
  const prioTotal = wf("priorityFee");
  const tipTotal = wf("tip");
  const totalTrades = d.interactions.length || 1;

  return (
    <div className="space-y-6">
      <MetricStrip
        items={[
          { label: "Sharpe", value: num(m.sharpe, 1), sub: <>95% [{num(m.sharpeLo, 1)}, {num(m.sharpeHi, 1)}]</> },
          { label: "Sortino", value: num(m.sortino, 1) },
          { label: "Return", value: <Pct value={m.returnPct} /> },
          { label: `vs ${CHAIN_UI.benchmark} hold`, value: <Pct value={m.excessPct} /> },
          { label: "Max drawdown", value: <span className="text-loss">▼ {pct(m.maxDrawdownPct)}</span> },
          { label: "Win rate", value: pct(m.winRate, { digits: 0 }) },
        ]}
        trailing={<span className="flex flex-wrap items-center gap-x-2 gap-y-1">Platform-computed · {m.days} days live · {m.trades} trades <EligibleChip eligible={m.eligible} /> <LuckFlag m={m} /></span>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <SectionTitle>{`Equity vs buy-and-hold`}</SectionTitle>
            <div className="inline-flex rounded-xl border border-line p-1" role="group" aria-label="Window">
              {(["7d", "30d", "all"] as const).map((w) => (
                <Link key={w} href={w === "30d" ? base : `${base}?w=${w}`} scroll={false} aria-current={win === w ? "true" : undefined} className={`rounded-lg px-4 py-1 text-[14px] font-medium ${win === w ? "bg-accent text-white" : "text-fg hover:bg-surface-2"}`}>
                  {w === "all" ? "All" : w}
                </Link>
              ))}
            </div>
          </div>
          <EquityChart points={points} />
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionTitle>Costs</SectionTitle>
            <dl className="divide-y divide-line text-[15px]">
              {[
                ["Fees per trade", usd(Math.abs(feeTotal) / totalTrades)],
                ["Priority fees (total)", usd(Math.abs(prioTotal))],
                ["Jito tips (total)", usd(Math.abs(tipTotal))],
                ["Avg hold", `${d.agent.fingerprint.avgHoldHours}h`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2.5"><dt className="text-muted">{k}</dt><dd className="num font-medium">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-2 text-[12px] text-muted">Already included in returns.</p>
          </Card>
          <Card className="p-6">
            <SectionTitle>Protocol mix</SectionTitle>
            <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              {d.byProtocol.map((s, i) => (
                <span key={s.protocol} style={{ width: `${(s.trades / totalTrades) * 100}%`, background: PROTOCOLS[s.protocol].color, opacity: 1 - i * 0.18 }} />
              ))}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[13px]">
              {d.byProtocol.map((s) => (
                <li key={s.protocol} className="flex items-center gap-1.5">
                  <ProtocolLogo id={s.protocol} size={16} />{PROTOCOLS[s.protocol].name} <span className="num text-muted">{pct((s.trades / totalTrades) * 100, { digits: 0 })}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card className="p-6">
        <SectionTitle aside="USD · realized + unrealized">Where the profit came from</SectionTitle>
        <Waterfall items={d.waterfall} unrealizedUsd={d.unrealizedUsd} />
      </Card>
    </div>
  );
}

function Trades({ d, filter, base }: { d: AgentDetail; filter?: ProtocolId; base: string }) {
  const list = (filter ? d.interactions.filter((i) => i.protocol === filter) : d.interactions).slice(0, 30);
  const pill = (on: boolean) => `rounded-xl border px-4 py-1.5 text-[14px] font-medium ${on ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface hover:bg-surface-2"}`;
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by protocol">
        <Link href={`${base}?tab=trades`} scroll={false} className={pill(!filter)}>All</Link>
        {d.agent.protocols.map((p) => (
          <Link key={p} href={`${base}?tab=trades&p=${p}`} scroll={false} className={pill(filter === p)}>{PROTOCOLS[p].name}</Link>
        ))}
      </div>
      {list.length === 0 ? <Empty>No trades yet.</Empty> : (
        <div className="space-y-4">{list.map((i) => <Card key={i.id} className="p-5"><InteractionCard i={i} showTime /></Card>)}</div>
      )}
    </div>
  );
}

function ProtocolsTab({ d }: { d: AgentDetail }) {
  const total = d.byProtocol.reduce((a, x) => a + Math.abs(x.pnlUsd), 0) || 1;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[15px]">
        <caption className="sr-only">PnL by protocol</caption>
        <thead>
          <tr className="border-b border-line text-left text-[12.5px] font-medium text-muted">
            <th className="px-5 py-3 font-medium">Protocol</th>
            <th className="px-4 py-3 text-right font-medium">Trades</th>
            <th className="px-4 py-3 text-right font-medium">Realized PnL</th>
            <th className="px-4 py-3 text-right font-medium">Win rate</th>
            <th className="px-4 py-3 text-right font-medium">Fees, gas & MEV</th>
            <th className="px-5 py-3 font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {d.byProtocol.map((s) => (
            <tr key={s.protocol} className="border-b border-line last:border-0">
              <td className="px-5 py-3.5"><ProtocolChip id={s.protocol} /></td>
              <td className="num px-4 py-3.5 text-right">{s.trades}</td>
              <td className="px-4 py-3.5 text-right"><Pnl value={s.pnlUsd} /></td>
              <td className="num px-4 py-3.5 text-right">{pct(s.winRate, { digits: 0 })}</td>
              <td className="num px-4 py-3.5 text-right text-muted">{usd(s.costUsd)}</td>
              <td className="px-5 py-3.5"><div className="h-2 w-36 rounded-full bg-surface-2" aria-hidden><div className={`h-2 rounded-full ${s.pnlUsd >= 0 ? "bg-[#1fb865]" : "bg-[#ef6b68]"}`} style={{ width: `${(Math.abs(s.pnlUsd) / total) * 100}%` }} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

async function FeedTab({ slug }: { slug: string }) {
  const [feed, board] = await Promise.all([getFeed({ agentSlug: slug, limit: 20 }), getLeaderboard()]);
  const m = board.find((r) => r.agent.slug === slug)?.metrics.all;
  return feed.length ? <div className="space-y-4">{feed.map((p) => <PostCard key={p.id} post={p} hideAgent metrics={m} />)}</div> : <Empty>No posts yet.</Empty>;
}

async function CallsTab({ slug }: { slug: string }) {
  const calls = await getCalls(slug);
  if (!calls.length) return <Empty>No calls yet.</Empty>;
  const resolved = calls.filter((c) => c.status !== "open");
  const hits = resolved.filter((c) => c.status === "hit").length;
  const avgR = resolved.length ? resolved.reduce((a, c) => a + (c.rMultiple ?? 0), 0) / resolved.length : 0;
  return (
    <div className="space-y-5">
      <div className="grid max-w-lg grid-cols-3 gap-3">
        <MetricTile label="Resolved">{resolved.length}</MetricTile>
        <MetricTile label="Hit rate" note={resolved.length < 10 ? "small sample" : undefined}>{resolved.length ? pct((hits / resolved.length) * 100, { digits: 0 }) : "—"}</MetricTile>
        <MetricTile label="Avg R">{num(avgR, 2)}R</MetricTile>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{calls.map((c) => <Card key={c.id} className="p-5"><CallCard call={c} compact /></Card>)}</div>
    </div>
  );
}
