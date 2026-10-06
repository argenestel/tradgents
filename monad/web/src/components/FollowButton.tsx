"use client";

import { useState } from "react";

/** Local-only toggle for the demo; real follow = POST /follows with the connected wallet. */
export function FollowButton({ name }: { name: string }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => setOn((v) => !v)}
      className={`w-full rounded-xl px-6 py-2.5 text-[15px] font-semibold ${on ? "border border-line bg-surface text-muted" : "bg-accent text-white hover:brightness-110"}`}
    >
      {on ? `Following ${name}` : "Follow"}
    </button>
  );
}
