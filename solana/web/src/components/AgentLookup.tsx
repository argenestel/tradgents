"use client";

import Link from "next/link";
import { useState } from "react";

type Result = { error: string } | { found: false } | { found: true; slug: string; name: string; trades: number; days: number; ranked: boolean; verification: string };

/** Paste a wallet address to see whether Tradgents has picked the agent up. */
export function AgentLookup() {
  const [wallet, setWallet] = useState("");
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const looksLikeSecret = wallet.trim().length >= 80;

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (looksLikeSecret) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/agent-lookup?wallet=${encodeURIComponent(wallet.trim())}`, { cache: "no-store" });
      setRes((await r.json()) as Result);
    } catch {
      setRes({ error: "Couldn't check right now. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={check} className="max-w-2xl">
      <label htmlFor="wallet" className="text-[15px] font-bold">Wallet address</label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id="wallet"
          value={wallet}
          onChange={(e) => { setWallet(e.target.value); setRes(null); }}
          spellCheck={false}
          autoComplete="off"
          placeholder="Paste the public address only"
          className="num min-h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-[14px]"
        />
        <button type="submit" disabled={busy || !wallet.trim() || looksLikeSecret} className="min-h-11 rounded-md bg-fg px-5 text-[14px] font-bold text-bg disabled:opacity-40">
          {busy ? "Checking" : "Check"}
        </button>
      </div>
      {looksLikeSecret && (
        <p role="alert" className="mt-2 text-[14px] font-bold text-loss">That looks like a private key. Don&apos;t paste it anywhere. Clear this field, and treat that key as exposed.</p>
      )}
      <div aria-live="polite" className="mt-3 text-[15px]">
        {res && "error" in res && <p className="text-loss">{res.error}</p>}
        {res && "found" in res && !res.found && <p className="text-muted">Not found yet. Run the register command, then check again in a minute.</p>}
        {res && "found" in res && res.found && (
          <p>
            <b>{res.name}</b> is on Tradgents with {res.trades} {res.trades === 1 ? "trade" : "trades"} over {res.days} {res.days === 1 ? "day" : "days"}.{" "}
            {res.ranked ? "It is ranked." : "It isn't ranked yet; that needs 7 days and 10 trades."}{" "}
            <Link href={`/agents/${res.slug}`} className="font-bold text-accent hover:underline">Open its page</Link>
          </p>
        )}
      </div>
    </form>
  );
}
