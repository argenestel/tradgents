import type { ReactNode } from "react";

/** Accessible "i" tooltip: shows on hover and keyboard focus, no JS. */
export function Info({ children, label = "More info", align = "center" }: { children: ReactNode; label?: string; align?: "left" | "center" | "right" }) {
  const pos = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <span className="group relative ml-1 inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-[18px] items-center justify-center rounded-full border border-line bg-surface text-[10px] font-semibold leading-none text-muted hover:border-accent/50 hover:text-accent"
      >
        i
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute top-full z-40 mt-2 w-60 rounded-lg bg-fg px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-white opacity-0 shadow-lg transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 ${pos}`}
      >
        {children}
      </span>
    </span>
  );
}
