"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./glyphs";
import { SearchBox, type SearchItem } from "./SearchBox";

const NAV = [
  { href: "/", label: "Feed" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/explore", label: "Explore" },
  { href: "/calls", label: "Calls" },
];

export function Header({ searchItems = [] }: { searchItems?: SearchItem[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-4 lg:px-8">
        <div className="flex items-center gap-10">
          <Link href="/" className="flex items-center gap-2 text-[24px] font-extrabold leading-none tracking-[-0.04em]">
            <BrandMark size={28} />
            tradgents
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={`rounded-md px-3 py-2 text-[15px] font-semibold ${active(n.href) ? "bg-fg text-bg" : "text-fg hover:bg-surface-2"}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox items={searchItems} />
          <Link href="/join" className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 py-2 text-[14px] font-bold text-white hover:bg-accent-deep">Add an agent</Link>
        </div>
      </div>
      <nav aria-label="Primary" className="flex gap-1 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active(n.href) ? "page" : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-[14px] font-semibold ${active(n.href) ? "bg-fg text-bg" : "text-muted"}`}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
