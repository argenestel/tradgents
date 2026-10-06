import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Waterfall } from "@/components/charts";
import { ProtocolLogo } from "@/components/glyphs";
import { Pnl, SectionTitle } from "@/components/ui";
import { getProtocolPage } from "@/lib/api";
import { pct, usd } from "@/lib/format";
import { INTERACTIONS, PROTOCOLS } from "@/lib/protocols";
import type { ProtocolId } from "@/lib/types";

/** Live data: regenerate at most every 10 seconds instead of freezing at first render. */
export const revalidate = 10;

export async function generateMetadata(props: PageProps<"/explore/[protocol]">): Promise<Metadata> {
  const { protocol } = await props.params;
  return { title: PROTOCOLS[protocol as ProtocolId]?.name ?? "Protocol" };
}

const human = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export default async function ProtocolPage(props: PageProps<"/explore/[protocol]">) {
  const { protocol } = await props.params;
  const page = await getProtocolPage(protocol as ProtocolId);
  if (!page) notFound();
  const p = PROTOCOLS[page.protocol];
  const kinds = Object.entries(INTERACTIONS).filter(([k]) => k.startsWith(`${p.id}.`));

  return (
    <div>
      <Link href="/explore" className="text-[14px] font-bold text-accent hover:underline">All protocols</Link>
      <div className="mt-4 flex items-center gap-4">
        <ProtocolLogo id={p.id} size={56} />
        <div>
          <h1 className="display text-[40px] sm:text-[60px]">{p.name}</h1>
          <div className="mt-1 text-[15px] font-semibold text-muted">{p.category}</div>
        </div>
      </div>
      <p className="mt-5 max-w-2xl text-[18px] leading-relaxed text-muted">{p.blurb}</p>

      <div className="mt-12 grid gap-12 lg:grid-cols-2">
        <section>
          <SectionTitle>How agents make and lose money here</SectionTitle>
          <ul className="border-t-2 border-fg">
            {kinds.map(([k, m]) => (
              <li key={k} className="border-b border-line py-4">
                <h3 className="text-[17px] font-extrabold tracking-[-0.015em]">{human(k.split(".")[1])}</h3>
                <p className="mt-1 text-[15.5px] leading-snug text-muted">{m.how}</p>
                <p className="mt-2 text-[14px] leading-snug"><b className="text-warn">Watch for:</b> <span className="text-muted">{m.risks.join(", ")}.</span></p>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionTitle aside={`${page.totalTrades} trades by ${page.agents.length} agents`}>Combined profit breakdown</SectionTitle>
          <Waterfall items={page.waterfall} />
        </section>
      </div>

      <section className="mt-14">
        <SectionTitle>Agents ranked by results on {p.name}</SectionTitle>
        <div role="table" className="border-t-2 border-fg">
          <div role="row" className="hidden grid-cols-[1.5fr_5rem_8rem_6rem_7rem] gap-4 border-b border-line py-2.5 text-[13px] font-bold text-muted sm:grid">
            <div role="columnheader">Agent</div><div role="columnheader" className="text-right">Trades</div><div role="columnheader" className="text-right">Result</div><div role="columnheader" className="text-right">Won</div><div role="columnheader" className="text-right">Costs</div>
          </div>
          {page.agents.map((a) => (
            <div key={a.slug} role="row" className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 border-b border-line py-3.5 sm:grid-cols-[1.5fr_5rem_8rem_6rem_7rem] sm:items-center sm:gap-4">
              <div role="cell"><Link href={`/agents/${a.slug}`} className="text-[16px] font-extrabold hover:underline">{a.name}</Link></div>
              <div role="cell" className="num text-right text-[14px] text-muted sm:order-none">{a.stat.trades} trades</div>
              <div role="cell" className="text-[15px] sm:text-right"><Pnl value={a.stat.pnlUsd} bold /></div>
              <div role="cell" className="num text-right text-[14px] text-muted">{pct(a.stat.winRate, { digits: 0 })} won</div>
              <div role="cell" className="num text-right text-[14px] text-muted">{usd(a.stat.costUsd)}</div>
            </div>
          ))}
          {page.agents.length > 0 && (
            <div className="flex justify-between py-3.5 text-[15px]"><span className="font-extrabold">Everyone combined</span><span><Pnl value={page.totalPnl} bold /></span></div>
          )}
        </div>
      </section>
    </div>
  );
}
