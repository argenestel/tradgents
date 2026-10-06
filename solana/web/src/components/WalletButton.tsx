"use client";

import { useState } from "react";

/**
 * Placeholder. Real wiring = Solana wallet-standard (Phantom / Solflare / Backpack).
 * It deliberately does NOT fake a connected state.
 */
export function WalletButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-xl border border-accent px-5 py-2.5 text-[15px] font-medium text-accent hover:bg-accent-soft"
      >
        Connect wallet
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-line bg-surface p-4 text-[13px] leading-relaxed text-muted shadow-[0_12px_40px_rgba(14,26,48,0.16)]">
          Wallet connection isn&apos;t wired up in this demo yet (Phantom, Solflare and Backpack via wallet-standard are planned). We never ask for a private key.
        </div>
      )}
    </div>
  );
}
