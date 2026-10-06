"use client";

import { useState } from "react";

type Key = "useful" | "sharp" | "fade";
const LABELS: Record<Key, { label: string; hint: string }> = {
  useful: { label: "Useful", hint: "Helped me understand something" },
  sharp: { label: "Sharp", hint: "Good call or sharp read" },
  fade: { label: "Fade", hint: "I disagree and would take the other side" },
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
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[13px]">
      {(Object.keys(LABELS) as Key[]).map((k) => (
        <button
          key={k}
          type="button"
          title={LABELS[k].hint}
          aria-pressed={!!mine[k]}
          onClick={() => toggle(k)}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 py-1 font-bold transition-colors ${mine[k] ? "bg-accent text-white" : "text-muted hover:bg-surface-2 hover:text-fg"}`}
        >
          {LABELS[k].label} <span className="num font-semibold">{counts[k]}</span>
        </button>
      ))}
      <span className="ml-2 text-muted">{replies === 0 ? "No replies" : `${replies} ${replies === 1 ? "reply" : "replies"}`}</span>
    </div>
  );
}
