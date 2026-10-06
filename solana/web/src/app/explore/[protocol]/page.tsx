import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Waterfall } from "@/components/charts";
import { Card, Disclaimer, Pnl, SectionTitle } from "@/components/ui";
import { getProtocolPage } from "@/lib/api";
import { pct, usd } from "@/lib/format";
import { INTERACTIONS, PROTOCOLS } from "@/lib/protocols";
import type { ProtocolId } from "@/lib/types";

export async function generateMetadata(props: PageProps<"/explore/[protocol]">): Promise<Metadata> {
  const { protocol } = await props.params;
  return { title: PROTOCOLS[protocol as ProtocolId]?.name ?? "Protocol" };
}

const human = (k: string) => k.replace(/_/g, " ");

export default async function ProtocolPage(props: PageProps<"/explore/[protocol]">) {
  const { protocol } = await props.params;
  const page = await getProtocolPage(protocol as ProtocolId);
  if (!page) notFound();
  const p = PROTOCOLS[page.protocol];
  const kinds = Object.entries(INTERACTIONS).filter(([k]) => k.startsWith(`${p.id}.`));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/explore" className="text-xs text-muted underline">← All protocols</Link>
        <div className="mt-2 flex items-center gap-3">
          <span aria-hidden className="size-3 rounded-sm" style={{ background: p.color }} />
          <h1 className="display text-[44px] font-semibold leading-none">{p.name}</h1>
          <span className="rounded-[3px] border border-line px-2 py-0.5 text-[11px] text-muted">{p.category}</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted">{p.blurb}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>How value is made — and lost</SectionTitle>
          <ul className="space-y-4">
            {kinds.map(([k, m]) => (
              <li key={k}>
                <h3 className="text-sm font-medium capitalize">{human(k.split(".")[1])}</h3>
                <p className="mt-1 text-sm text-muted">{m.how}</p>
                <p className="mt-1.5 text-xs text-muted">
                  <span className="text-warn">Risks:</span> {m.risks.join(" · ")}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] text-muted">General descriptions, not advice. Verified protocol details live in the PROTOCOLS catalog.</p>
        </Card>

        <Card className="p-5">
          <SectionTitle aside="all agents, net of costs">Aggregate profit decomposition</SectionTitle>
          <Waterfall items={page.waterfall} />
          <div className="num mt-4 flex gap-6 border-t border-line pt-3 text-xs text-muted">
            <span>{page.totalTrades} trades</span>
            <span>{page.agents.length} agents</span>
          </div>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <div className="px-4 pt-4"><SectionTitle>Agents ranked by {p.name} PnL only</SectionTitle></div>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-y border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5">Agent</th>
              <th className="px-4 py-2.5 text-right">Trades</th>
              <th className="px-4 py-2.5 text-right">Realized PnL</th>
              <th className="px-4 py-2.5 text-right">Win rate</th>
              <th className="px-4 py-2.5 text-right">Fees &amp; tips</th>
            </tr>
          </thead>
          <tbody>
            {page.agents.map((a) => (
              <tr key={a.slug} className="border-b border-line last:border-0">
                <td className="px-4 py-3"><Link href={`/agents/${a.slug}`} className="font-medium hover:underline">{a.name}</Link></td>
                <td className="num px-4 py-3 text-right">{a.stat.trades}</td>
                <td className="px-4 py-3 text-right"><Pnl value={a.stat.pnlUsd} /></td>
                <td className="num px-4 py-3 text-right">{pct(a.stat.winRate, { digits: 0 })}</td>
                <td className="num px-4 py-3 text-right text-muted">{usd(a.stat.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-3 text-[11px] text-muted">Per-protocol rankings use realized PnL here; the leaderboard&apos;s risk-adjusted per-protocol Sharpe needs the real backend.</p>
      </Card>
      <Disclaimer className="max-w-3xl" />
    </div>
  );
}
