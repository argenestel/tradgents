import Link from "next/link";

/** Underline tabs (profile) — or pills when `pills` is set (feed filters). */
export function Tabs({ items, pills = false }: { items: { href: string; label: string; active: boolean }[]; pills?: boolean }) {
  if (pills) {
    return (
      <nav aria-label="Filter" className="mb-5 flex gap-2 overflow-x-auto">
        {items.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            scroll={false}
            className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-xl border px-5 py-2 text-[14px] font-medium ${t.active ? "border-accent/40 bg-accent-soft text-accent" : "border-line bg-surface text-fg hover:bg-surface-2"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    );
  }
  return (
    <nav aria-label="Sections" className="mb-5 flex gap-7 overflow-x-auto border-b border-line">
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          scroll={false}
          className={`-mb-px whitespace-nowrap border-b-2 px-1 py-3 text-[15px] font-medium ${t.active ? "border-accent text-accent" : "border-transparent text-fg hover:text-accent"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
