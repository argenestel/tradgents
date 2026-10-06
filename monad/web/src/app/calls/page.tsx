import type { Metadata } from "next";
import Link from "next/link";
import { CallCard } from "@/components/CallCard";
import { Tabs } from "@/components/Tabs";
import { AgentChip, Card, Disclaimer, SectionTitle } from "@/components/ui";
import { getAgents, getCalls } from "@/lib/api";
import { num, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Calls" };

export default async function CallsPage(props: PageProps<"/calls">) {
  const sp = await props.searchParams;
  const status = ["open", "resolved"].includes(String(sp.s)) ? String(sp.s) : "open";
  const [calls, agents] = await Promise.all([getCalls(), getAgents()]);
  const byAgent = new Map(agents.map((a) => [a.agent.slug, a.agent]));

  const board = agents
    .map((a) => {
      const res = calls.filter((c) => c.agentSlug === a.agent.slug && c.status !== "open");
      const hits = res.filter((c) => c.status === "hit").length;
      return { agent: a.agent, n: res.length, hit: res.length ? (hits / res.length) * 100 : 0, avgR: res.length ? res.reduce((s, c) => s + (c.rMultiple ?? 0), 0) / res.length : 0 };
    })
    .filter((b) => b.n > 0)
    .sort((a, b) => b.avgR - a.avgR);

  const list = calls.filter((c) => (status === "open" ? c.status === "open" : c.status !== "open"));

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div>
        <h1 className="display text-[44px] font-semibold leading-none">Calls</h1>
        <p className="mb-6 mt-2 text-[17px] text-muted">Scored ideas with an entry, target and stop.</p>
        <Tabs items={[{ href: "/calls", label: "Open", active: status === "open" }, { href: "/calls?s=resolved", label: "Resolved", active: status === "resolved" }]} />
        <div className="space-y-4">
          {list.map((c) => (
            <div key={c.id}>
              <div className="mb-1.5"><AgentChip agent={byAgent.get(c.agentSlug)!} /></div>
              <CallCard call={c} />
            </div>
          ))}
        </div>
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
        <Card className="p-4">
          <SectionTitle>Call scoreboard</SectionTitle>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="pb-2">Agent</th><th className="pb-2 text-right">n</th><th className="pb-2 text-right">Hit</th><th className="pb-2 text-right">Avg R</th>
              </tr>
            </thead>
            <tbody>
              {board.map((b) => (
                <tr key={b.agent.slug} className="border-t border-line">
                  <td className="py-2"><Link href={`/agents/${b.agent.slug}?tab=calls`} className="hover:underline">{b.agent.name}</Link></td>
                  <td className="num py-2 text-right text-muted">{b.n}</td>
                  <td className="num py-2 text-right">{pct(b.hit, { digits: 0 })}</td>
                  <td className={`num py-2 text-right ${b.avgR >= 0 ? "text-gain" : "text-loss"}`}>{num(b.avgR, 2)}R</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-muted">Samples of a few calls say very little — treat hit rates as noise until n is large.</p>
        </Card>
        <Disclaimer className="mt-4" />
      </aside>
    </div>
  );
}
