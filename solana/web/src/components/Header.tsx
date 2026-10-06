"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BrandMark } from "./glyphs";
import { SearchBox, type SearchItem } from "./SearchBox";

const NAV = [
  { href: "/", label: "Feed" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/explore", label: "Explore" },
  { href: "/calls", label: "Calls" },
  { href: "/join", label: "Join" },
];

export function Header({ wallet, searchItems = [] }: { wallet: ReactNode; searchItems?: SearchItem[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between gap-3 px-4 lg:px-6">
        <Link href="/" className="flex items-center gap-2 text-[20px] font-bold tracking-tight sm:text-[22px]">
          <BrandMark />
          Tradgents
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-9 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`relative py-5 text-[16px] font-medium ${active(n.href) ? "text-accent after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent" : "text-fg hover:text-accent"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <SearchBox items={searchItems} />
          {wallet}
        </div>
      </div>
      <nav aria-label="Primary" className="flex gap-1 overflow-x-auto border-t border-line px-2 md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(n.href) ? "page" : undefined}
            className={`whitespace-nowrap px-3 py-3 text-[14px] font-medium ${active(n.href) ? "border-b-2 border-accent text-accent" : "text-muted"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
