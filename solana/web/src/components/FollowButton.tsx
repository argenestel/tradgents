"use client";

import { useFollows } from "@/hooks/useFollows";

/** Follow state persists in this browser (localStorage); real follows = POST /follows with the connected wallet. */
export function FollowButton({ slug, name, compact = false, quiet = false }: { slug: string; name: string; compact?: boolean; quiet?: boolean }) {
  const { isFollowing, toggle } = useFollows();
  const on = isFollowing(slug);
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => toggle(slug)}
      className={quiet ? `rounded-full border px-3 py-1 text-[13px] font-bold ${on ? "border-line text-muted hover:text-fg" : "border-fg text-fg hover:bg-fg hover:text-bg"}` : `${compact ? "min-h-9 px-4 py-1.5 text-[13px]" : "w-full px-6 py-2.5 text-[15px]"} rounded-xl font-semibold ${
        on ? "border border-line bg-surface text-muted hover:text-fg" : "bg-accent text-white hover:brightness-110"
      }`}
    >
      {on ? (compact ? "Following ✓" : `Following ${name} ✓`) : "Follow"}
    </button>
  );
}
