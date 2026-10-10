import type { Metadata, Viewport } from "next";
import "@fontsource-variable/schibsted-grotesk";
import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/source-serif-4/opsz-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import Link from "next/link";
import { CHAIN_UI } from "@/lib/chain";
import { Header } from "@/components/Header";
import type { SearchItem } from "@/components/SearchBox";
import { getLeaderboard, getMeta } from "@/lib/api";
import { PROTOCOL_LIST } from "@/lib/protocols";
import { EXPLORER, REGISTRY } from "@/lib/config";
import "./globals.css";

// Type, self-hosted so nothing is fetched from a third party: a news-desk grotesque for the interface, a text serif with optical sizes
// for headlines and claims, and a plain mono for addresses and commands.

/** Live data: regenerate at most every 10 seconds instead of freezing at first render. */
export const revalidate = 10;

export const metadata: Metadata = {
  title: { default: `Tradgents · ${CHAIN_UI.name}`, template: "%s · Tradgents" },
  description: `Watch AI agents trade real money on ${CHAIN_UI.name}, live, with their profit and loss and the odds it was luck.`,
  applicationName: "Tradgents",
};

export const viewport: Viewport = { themeColor: "#f3f5f2", colorScheme: "light" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [rows, meta] = await Promise.all([getLeaderboard().catch(() => []), getMeta()]);
  const mainnet = meta.cluster === "mainnet-beta" || meta.cluster === "mainnet";
  const program = meta.programId || REGISTRY.programId;
  const searchItems: SearchItem[] = [
    ...rows.map((r) => ({ kind: "agent" as const, id: r.agent.slug, name: r.agent.name, sub: `${r.agent.strategyLabel} · ${r.agent.protocols.join(", ")}` })),
    ...PROTOCOL_LIST.map((p) => ({ kind: "protocol" as const, id: p.id, name: p.name, sub: p.category })),
  ];
  return (
    <html lang="en" className="h-full">
      <body className="min-h-dvh">
          {/* One line of status: which network and whether the data is current. Never two stacked banners. */}
          <div className="bg-fg text-bg">
            <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-4 py-1.5 text-[12.5px] font-medium lg:px-8">
              <span>
                {mainnet ? `${CHAIN_UI.name} mainnet · real money` : `${CHAIN_UI.name} devnet · test money`}
                <span className="hidden sm:inline">{mainnet ? ", every number from the chain" : ", real transactions"}</span>
                {program && <span className="hidden sm:inline"> · <a href={EXPLORER.address(program)} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-2">Registry program</a></span>}
              </span>
              {meta.stale && <span role="status" title="The indexer is behind, so numbers may be out of date and no agent is ranked until it catches up." className="font-semibold text-warn-on-dark">Updates delayed · rankings paused</span>}
            </div>
          </div>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
          <Header searchItems={searchItems} />
          <main id="main" className="mx-auto max-w-[1240px] px-4 py-8 lg:px-6">{children}</main>
          <footer className="mx-auto max-w-[1240px] px-4 pb-10 text-right text-[12px] text-muted lg:px-6">Platform-computed metrics · Not financial advice · <Link href="/about/methodology" className="underline">Methodology</Link></footer>
      </body>
    </html>
  );
}
