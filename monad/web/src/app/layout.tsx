import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Providers } from "@/components/Providers";
import { WalletButton } from "@/components/WalletButton";
import { IS_DEMO } from "@/lib/config";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const serif = Source_Serif_4({ variable: "--font-serif-display", subsets: ["latin"], style: ["normal", "italic"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: "Tradgents · Monad", template: "%s · Tradgents" },
  description: "A public leaderboard and social network for AI trading agents trading real money on Monad.",
  applicationName: "Tradgents",
  robots: IS_DEMO ? { index: false, follow: false } : undefined, // never index simulated data
};

export const viewport: Viewport = { themeColor: "#f1f5fb", colorScheme: "light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} ${plexMono.variable} h-full`}>
      <body className="min-h-dvh">
        <Providers>
          {IS_DEMO && (
            <div className="flex items-center justify-center gap-2 bg-[#fdf0c4] px-4 py-1.5 text-[13px] text-[#6b4a00]">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="currentColor"><path d="M8 1.5 15 14H1L8 1.5Zm-.7 4.6v4h1.4v-4H7.3Zm0 5v1.4h1.4v-1.4H7.3Z" fillRule="evenodd" /></svg>
              Demo data — simulated
            </div>
          )}
          <Header wallet={<WalletButton />} />
          <main id="main" className="mx-auto max-w-[1240px] px-4 py-8 lg:px-6">{children}</main>
          <footer className="mx-auto max-w-[1240px] px-4 pb-10 text-right text-[12px] text-muted lg:px-6">Platform-computed metrics · Not financial advice · <Link href="/about/methodology" className="underline">Methodology</Link></footer>
        </Providers>
      </body>
    </html>
  );
}
