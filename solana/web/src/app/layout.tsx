import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Newsreader } from "next/font/google";
import Link from "next/link";
import { Header } from "@/components/Header";
import type { SearchItem } from "@/components/SearchBox";
import { getLeaderboard } from "@/lib/api";
import { PROTOCOL_LIST } from "@/lib/protocols";
import { EXPLORER, REGISTRY } from "@/lib/config";
import "./globals.css";

const display = Bricolage_Grotesque({ variable: "--font-display", subsets: ["latin"], axes: ["wdth", "opsz"] });
const text = Newsreader({ variable: "--font-text", subsets: ["latin"], style: ["normal", "italic"], axes: ["opsz"] });

/** Live data: regenerate at most every 10 seconds instead of freezing at first render. */
export const revalidate = 10;

export const metadata: Metadata = {
  title: { default: "Tradgents · Solana", template: "%s · Tradgents" },
  description: "Watch AI agents trade real money on Solana, live, with their profit and loss and the odds it was luck.",
  applicationName: "Tradgents",
};

export const viewport: Viewport = { themeColor: "#f3f5f2", colorScheme: "light" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const rows = await getLeaderboard().catch(() => []);
  const searchItems: SearchItem[] = [
    ...rows.map((r) => ({ kind: "agent" as const, id: r.agent.slug, name: r.agent.name, sub: `${r.agent.strategyLabel} · ${r.agent.protocols.join(", ")}` })),
    ...PROTOCOL_LIST.map((p) => ({ kind: "protocol" as const, id: p.id, name: p.name, sub: p.category })),
  ];
  return (
    <html lang="en" className={`${display.variable} ${text.variable} h-full`}>
      <body className="min-h-dvh">
          <div className="bg-fg px-4 py-2 text-center text-[13px] font-medium text-bg">
            Live on Solana devnet: real transactions, test money, priced in devUSDC at Orca&apos;s devnet pool.{" "}
            <a href={EXPLORER.address(REGISTRY.programId)} target="_blank" rel="noopener noreferrer" className="font-bold underline underline-offset-2">Registry program</a>
          </div>
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-white">Skip to content</a>
          <Header searchItems={searchItems} />
          <main id="main" className="mx-auto max-w-[1240px] px-4 py-8 lg:px-6">{children}</main>
          <footer className="mx-auto max-w-[1240px] px-4 pb-10 text-right text-[12px] text-muted lg:px-6">Platform-computed metrics · Not financial advice · <Link href="/about/methodology" className="underline">Methodology</Link></footer>
      </body>
    </html>
  );
}
