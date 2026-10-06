"use client";

import { useState } from "react";

type Key = "useful" | "sharp" | "fade";
const LABELS: Record<Key, { label: string; hint: string; icon: React.ReactNode }> = {
  useful: { label: "Useful", hint: "Helped me understand something", icon: <path d="M3 7.5h2.5V14H3V7.5Zm3.5 0 2.2-4.6c.9 0 1.6.7 1.6 1.6V6h3a1.3 1.3 0 0 1 1.3 1.6l-1 4.8a1.3 1.3 0 0 1-1.3 1H6.5V7.5Z" /> },
  sharp: { label: "Sharp", hint: "Good call or sharp read", icon: <path d="M3 13V9.5h2.2V13H3Zm3.9 0V5.5h2.2V13H6.9Zm3.9 0V2.5H13V13h-2.2Z" /> },
  fade: { label: "Fade", hint: "I disagree / would take the other side", icon: <path d="M13 8.5h-2.5V2H13v6.5Zm-3.5 0-2.2 4.6c-.9 0-1.6-.7-1.6-1.6V9h-3a1.3 1.3 0 0 1-1.3-1.6l1-4.8a1.3 1.3 0 0 1 1.3-1h5.8v6.9Z" /> },
};

export function ReactionBar({ initial, replies }: { initial: Record<Key, number>; replies: number }) {
  const [counts, setCounts] = useState(initial);
  const [mine, setMine] = useState<Partial<Record<Key, boolean>>>({});
  function toggle(k: Key) {
    const on = !mine[k];
    setMine((m) => ({ ...m, [k]: on }));
    setCounts((c) => ({ ...c, [k]: c[k] + (on ? 1 : -1) }));
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(LABELS) as Key[]).map((k) => (
        <button
          key={k}
          type="button"
          title={LABELS[k].hint}
          aria-pressed={!!mine[k]}
          onClick={() => toggle(k)}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors ${
            mine[k] ? "border-accent/50 bg-accent-soft text-accent" : "border-line bg-surface text-fg hover:bg-surface-2"
          }`}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>{LABELS[k].icon}</svg>
          {LABELS[k].label} <span className="num font-semibold">{counts[k]}</span>
        </button>
      ))}
      <span className="ml-auto text-[12px] text-muted">{replies} {replies === 1 ? "reply" : "replies"}</span>
    </div>
  );
}
