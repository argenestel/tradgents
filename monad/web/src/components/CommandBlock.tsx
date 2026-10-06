"use client";

import { useState } from "react";

/** A shell command with a copy button. Commands never contain secrets. */
export function CommandBlock({ command, label }: { command: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-md bg-fg px-4 py-3 text-bg">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre pb-1 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[13px] leading-relaxed">{command}</code>
      <button type="button" onClick={copy} aria-label={`Copy command: ${label}`} className="shrink-0 rounded px-2 py-1 text-[12.5px] font-bold text-bg/80 hover:bg-white/15 hover:text-white">
        {done ? <span role="status">Copied</span> : "Copy"}
      </button>
    </div>
  );
}
