"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AgentGlyph, ProtocolLogo } from "./glyphs";

export interface SearchItem {
  kind: "agent" | "protocol";
  id: string; // slug or protocol id
  name: string;
  sub: string;
}

/** Command-palette style search. Open with "/" or Ctrl/⌘+K; ↑↓ to move, Enter to open, Esc to close. */
export function SearchBox({ items }: { items: SearchItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const pool = t ? items.filter((i) => `${i.name} ${i.sub}`.toLowerCase().includes(t)) : items.slice(0, 8);
    return pool.slice(0, 8);
  }, [q, items]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable=true]");
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setQ("");
    setActive(0);
    triggerRef.current?.focus();
  }
  function go(item: SearchItem) {
    router.push(item.kind === "agent" ? `/agents/${item.id}` : `/explore/${item.id}`);
    close();
  }
  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    if (e.key === "Enter" && results[active]) go(results[active]);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search agents and protocols"
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-line bg-surface px-3 text-[14px] text-muted hover:border-accent/40 hover:text-fg"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <span className="hidden lg:inline">Search</span>
        <kbd className="hidden rounded border border-line bg-surface-2 px-1.5 py-px text-[11px] font-bold lg:inline">/</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-fg/40 px-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div role="dialog" aria-modal="true" aria-label="Search" className="w-full max-w-xl overflow-hidden rounded-lg border border-line bg-surface shadow-[0_24px_80px_rgba(14,26,48,0.3)]">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={onInputKey}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
              placeholder="Search agents and protocols…"
              className="w-full border-b border-line bg-transparent px-5 py-4 text-[16px] outline-none placeholder:text-muted"
            />
            <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
              {results.length === 0 && <li className="px-4 py-6 text-center text-[14px] text-muted">No matches for “{q}”.</li>}
              {results.map((r, i) => (
                <li
                  key={`${r.kind}-${r.id}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                  className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 ${i === active ? "bg-accent-soft" : ""}`}
                >
                  {r.kind === "agent" ? <AgentGlyph name={r.name} size={32} /> : <ProtocolLogo id={r.id as never} size={32} />}
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium">{r.name}</div>
                    <div className="truncate text-[12px] text-muted">{r.sub}</div>
                  </div>
                  <span className="ml-auto text-[12px] font-semibold text-muted">{r.kind === "agent" ? "Agent" : "Protocol"}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-4 border-t border-line px-5 py-2 text-[11px] text-muted"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div>
          </div>
        </div>
      )}
    </>
  );
}
