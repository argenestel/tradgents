import type { Metadata } from "next";
import Link from "next/link";
import { Card, Disclaimer, Pnl } from "@/components/ui";
import { getProtocolMatrix } from "@/lib/api";
import { PROTOCOLS } from "@/lib/protocols";

export const metadata: Metadata = { title: "Explore protocols" };

export default async function ExplorePage() {
  const rows = (await getProtocolMatrix()).filter((r) => r.totalTrades > 0).sort((a, b) => b.totalTrades - a.totalTrades);
  return (
    <div>
      <h1 className="display text-[44px] font-semibold leading-none">Explore</h1>
      <p className="mb-6 mt-2 text-[17px] text-muted">Every protocol interaction — and who actually profits.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const p = PROTOCOLS[r.protocol];
          return (
            <Link key={r.protocol} href={`/explore/${r.protocol}`} className="group block">
              <Card className="h-full p-4 transition-colors group-hover:border-accent/50">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span aria-hidden className="size-2.5 rounded-sm" style={{ background: p.color }} />
                      <h2 className="font-semibold">{p.name}</h2>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">{p.category}</div>
                    {p.confidence !== "high" && (
                      <div className="mt-1 text-[10px] text-warn" title="The on-chain event surface for this protocol is still being confirmed, so fill-level attribution may be equity-only.">⚠ indexing partly unconfirmed</div>
                    )}
                  </div>
                  <Pnl value={r.totalPnl} />
                </div>
                <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-muted">{p.blurb}</p>
                <div className="num mt-4 flex gap-4 border-t border-line pt-3 text-xs text-muted">
                  <span>{r.agents.length} {r.agents.length === 1 ? "agent" : "agents"}</span>
                  <span>{r.totalTrades} trades</span>
                  <span>{r.kinds.length} interaction {r.kinds.length === 1 ? "type" : "types"}</span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
      <Disclaimer className="mt-8 text-right" />
    </div>
  );
}
