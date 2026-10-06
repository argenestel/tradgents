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
        className="min-h-10 rounded-md bg-accent px-4 py-2 text-[14px] font-bold text-white hover:bg-accent-deep"
      >
        Connect wallet
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-line bg-surface p-4 text-[14px] leading-snug text-muted shadow-[0_16px_48px_rgba(12,22,51,0.18)]">
          Wallet connection isn&apos;t built yet. Phantom, Solflare and Backpack are planned. Tradgents will never ask for your private key.
        </div>
      )}
    </div>
  );
}
