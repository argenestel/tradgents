"use client";

import { useId, useState } from "react";
import { useConnection, useChainId } from "wagmi";
import { CHAIN } from "@/lib/config";
import { shortAddr, usd } from "@/lib/format";
import { useMounted } from "@/hooks/useMounted";

/**
 * Non-custodial copy flow (demo numbers). In production the backend returns calldata for the
 * USER'S wallet to sign; the platform never routes funds. We only ever propose an exact-amount
 * approval, never unlimited.
 */
export function CopyPanel({ pair, protocol, spender, agentNotionalUsd, ageMinutes }: { pair: string; protocol: string; spender: string; agentNotionalUsd: number; ageMinutes: number }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(100);
  const id = useId();
  const mounted = useMounted();
  const { address, isConnected } = useConnection();
  const chainId = useChainId();

  const impactBps = 3 + (size / Math.max(1, agentNotionalUsd)) * 40;
  const slipBps = impactBps + Math.min(120, ageMinutes * 0.05);
  const stale = ageMinutes > 10;
  const ready = mounted && isConnected && chainId === CHAIN.id;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-lg border border-accent/40 bg-surface px-3 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
      >
        Copy
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg>
      </button>
      {open && (
        <div id={id} className="absolute bottom-full right-0 z-20 mb-2 w-[320px] rounded-xl border border-line bg-surface p-4 text-[13px] text-fg shadow-[0_12px_40px_rgba(14,26,48,0.16)]">
          <div className="flex items-center justify-between">
            <b>Copy {pair} via {protocol}</b>
            <span className="rounded bg-warn-bg px-1.5 py-0.5 text-[11px] text-warn">simulated</span>
          </div>
          <label className="mt-3 flex items-center gap-3 text-muted">
            Size
            <input type="range" min={10} max={1000} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
            <span className="num w-14 text-right text-fg">{usd(size)}</span>
          </label>
          <dl className="num mt-3 grid grid-cols-2 gap-y-1.5 text-[12.5px]">
            <dt className="font-sans text-muted">Price impact</dt><dd className="text-right">{impactBps.toFixed(1)} bps</dd>
            <dt className="font-sans text-muted">Worse than agent</dt><dd className="text-right">≈ {slipBps.toFixed(1)} bps</dd>
            <dt className="font-sans text-muted" title="Monad charges gas on the gas limit">Gas</dt><dd className="text-right">≈ $0.02</dd>
          </dl>
          <p className="mt-3 rounded-lg bg-surface-2 p-2.5 text-[12px] text-muted">
            Approves <b className="text-fg">exactly {usd(size)}</b> to {spender} — never unlimited.
          </p>
          {stale && <p className="mt-2 text-[12px] text-warn">⚠ Trade is {Math.round(ageMinutes)} min old — the edge may be gone.</p>}
          <button type="button" disabled title="Calldata comes from the backend, which isn't live yet" className="mt-3 w-full cursor-not-allowed rounded-lg bg-accent/40 px-3 py-2 font-medium text-white">
            Review in wallet
          </button>
          <p className="mt-2 text-[11px] text-muted">{ready ? `${shortAddr(address!)} ready on ${CHAIN.name}.` : "Connect a wallet on Monad to continue."}</p>
        </div>
      )}
    </div>
  );
}
