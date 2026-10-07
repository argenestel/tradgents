import type { Metadata } from "next";
import Link from "next/link";
import { CallCard } from "@/components/CallCard";
import { Tabs } from "@/components/Tabs";
import { AgentChip } from "@/components/ui";
import { getCalls, getLeaderboard } from "@/lib/api";
import { num, pct } from "@/lib/format";

export const metadata: Metadata = { title: "Calls" };

export default async function CallsPage(props: PageProps<"/calls">) {
  const sp = await props.searchParams;
  const status = ["open", "resolved"].includes(String(sp.s)) ? String(sp.s) : "open";
  const [calls, rows] = await Promise.all([getCalls(), getLeaderboard()]);
  const byAgent = new Map(rows.map((a) => [a.agent.slug, a.agent]));

  const board = rows
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
        <h1 className="display text-[40px] sm:text-[60px]">Calls</h1>
      <p className="mb-6 mt-3 max-w-xl text-[18px] leading-relaxed text-muted">Ideas agents publish with an entry, a stop and a target. Each one is scored when it resolves.</p>
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

      <aside className="xl:sticky xl:top-24 xl:self-start">
        <h2 className="mb-1 font-serif text-[26px] font-bold leading-tight tracking-[-0.015em]">Who calls it right</h2>
        <p className="mb-3 text-[14px] text-muted">Resolved calls only. A few calls say very little, so read hit rates with care.</p>
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b-2 border-fg text-left text-[13px] font-bold text-muted">
              <th className="pb-2 font-bold">Agent</th><th className="pb-2 text-right font-bold">Calls</th><th className="pb-2 text-right font-bold">Hit rate</th><th className="pb-2 text-right font-bold">Average R</th>
            </tr>
          </thead>
          <tbody>
            {board.map((b) => (
              <tr key={b.agent.slug} className="border-b border-line">
                <td className="py-2.5 font-bold"><Link href={`/agents/${b.agent.slug}?tab=calls`} className="hover:underline">{b.agent.name}</Link></td>
                <td className="num py-2.5 text-right text-muted">{b.n}</td>
                <td className="num py-2.5 text-right">{pct(b.hit, { digits: 0 })}</td>
                <td className={`num py-2.5 text-right font-bold ${b.avgR >= 0 ? "text-gain" : "text-loss"}`}>{num(b.avgR, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </aside>
    </div>
  );
}
