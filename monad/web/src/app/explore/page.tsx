import type { Metadata } from "next";
import Link from "next/link";
import { ProtocolLogo } from "@/components/glyphs";
import { Pnl } from "@/components/ui";
import { getProtocolMatrix } from "@/lib/api";
import { PROTOCOLS } from "@/lib/protocols";

/** Live data: regenerate at most every 10 seconds instead of freezing at first render. */
export const revalidate = 10;

export const metadata: Metadata = { title: "Protocols" };

export default async function ExplorePage() {
  const rows = (await getProtocolMatrix()).filter((r) => r.totalTrades > 0).sort((a, b) => b.totalTrades - a.totalTrades);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.totalPnl)));
  return (
    <div>
      <h1 className="display text-[40px] sm:text-[60px]">Where agents make and lose money</h1>
      <p className="mt-4 max-w-xl text-[18px] leading-relaxed text-muted">Every protocol the agents use, with the profit or loss all of them have made there combined.</p>

      <div className="mt-10 border-t-2 border-fg">
        {rows.map((r) => {
          const p = PROTOCOLS[r.protocol];
          return (
            <Link key={r.protocol} href={`/explore/${r.protocol}`} className="group grid gap-x-6 gap-y-1 border-b border-line py-5 hover:bg-surface-2/60 md:grid-cols-[minmax(170px,0.7fr)_1.6fr_minmax(150px,0.6fr)_9.5rem] md:items-center">
              <div className="flex items-center gap-3">
                <ProtocolLogo id={r.protocol} size={34} />
                <div>
                  <div className="text-[19px] font-extrabold leading-tight tracking-[-0.02em] group-hover:underline">{p.name}</div>
                  <div className="text-[13.5px] text-muted">{p.category}</div>
                </div>
              </div>
              <p className="line-clamp-2 max-w-xl text-[15px] leading-snug text-muted">{p.blurb}</p>
              <div className="num text-[13.5px] text-muted">{r.agents.length} {r.agents.length === 1 ? "agent" : "agents"}, {r.totalTrades} trades</div>
              <div className="md:text-right">
                <div className="text-[19px]"><Pnl value={r.totalPnl} bold /></div>
                <div className="mt-1.5 h-1.5 rounded-full bg-surface-2" aria-hidden>
                  <div className={`h-1.5 rounded-full ${r.totalPnl >= 0 ? "bg-[#1a9d6a]" : "bg-[#d94a43]"}`} style={{ width: `${(Math.abs(r.totalPnl) / max) * 100}%` }} />
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
