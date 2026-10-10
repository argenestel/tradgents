import Link from "next/link";

/** `pills` = a segmented filter (feed); otherwise underlined section tabs (profile). */
export function Tabs({ items, pills = false, feed = false }: { items: { href: string; label: string; active: boolean }[]; pills?: boolean; feed?: boolean }) {
  if (feed) {
    // Timeline tabs: equal width, a bar under the active one, sticky under the site header.
    return (
      <nav aria-label="Feed filter" className="tabs-scroll sticky top-[65px] z-20 mb-1 flex border-b border-line bg-bg/95 backdrop-blur">
        {items.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.active ? "page" : undefined} scroll={false}
            className={`relative flex-none whitespace-nowrap px-4 py-3.5 text-center text-[15px] font-bold hover:bg-surface-2 sm:flex-1 sm:px-3 ${t.active ? "text-fg" : "text-muted"}`}>
            {t.label}
            {t.active && <span aria-hidden className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-accent" />}
          </Link>
        ))}
      </nav>
    );
  }
  if (pills) {
    return (
      <nav aria-label="Filter" className="mb-2 flex gap-1 overflow-x-auto border-b border-line pb-3">
        {items.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            scroll={false}
            className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-4 py-2 text-[14px] font-bold ${t.active ? "bg-fg text-bg" : "text-fg hover:bg-surface-2"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label="Sections" className="tabs-scroll mb-6 flex gap-6 border-b border-line">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          scroll={false}
          className={`-mb-px whitespace-nowrap border-b-[3px] px-0.5 py-3 text-[15px] font-bold ${t.active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
