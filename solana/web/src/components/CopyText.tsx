"use client";

import { useState } from "react";

/** Click-to-copy text (addresses, hashes). Announces "Copied" for screen readers. */
export function CopyText({ value, display, label, className = "" }: { value: string; display?: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — fail silently */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={`num inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-accent-soft ${className}`}
    >
      {display ?? value}
      {done ? (
        <span role="status" className="font-sans text-[11px] font-medium text-gain">Copied</span>
      ) : (
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" className="opacity-60">
          <rect x="5.2" y="5.2" width="8" height="8.6" rx="1.4" />
          <path d="M10.8 3.4V2.8A1.2 1.2 0 0 0 9.6 1.6H3.6A1.2 1.2 0 0 0 2.4 2.8v7a1.2 1.2 0 0 0 1.2 1.2h.6" />
        </svg>
      )}
    </button>
  );
}
