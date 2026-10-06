"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { CHAIN } from "@/lib/config";
import { shortAddr } from "@/lib/format";
import { useMounted } from "@/hooks/useMounted";

/**
 * Real wallet connection (wagmi + viem, injected / EIP-6963 wallets).
 * The header never requests approvals or transactions — it only connects,
 * switches network and shows a balance.
 */
export function WalletButton() {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const { address, isConnected, chainId, connector } = useConnection();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error, reset } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();
  const { data: balance } = useBalance({ address, chainId: CHAIN.id, query: { enabled: isConnected } });

  if (!mounted) {
    return <div className="h-[44px] w-[150px] rounded-xl border border-line bg-surface" aria-hidden />;
  }

  const wrongNetwork = isConnected && chainId !== CHAIN.id;
  // With EIP-6963 each installed wallet is its own connector; hide the generic fallback when named ones exist.
  const named = connectors.filter((c) => c.id !== "injected");
  // The generic "injected" connector only works if something injected window.ethereum.
  const hasLegacyProvider = typeof window !== "undefined" && "ethereum" in window;
  const options = named.length ? named : hasLegacyProvider ? connectors : [];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          reset();
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`rounded-xl border px-5 py-2.5 text-[15px] font-medium hover:bg-accent-soft ${wrongNetwork ? "border-warn text-warn" : "border-accent text-accent"}`}
      >
        {isConnected ? (wrongNetwork ? "Wrong network" : <span className="num">{shortAddr(address!)}</span>) : "Connect wallet"}
      </button>

      {open && (
        <div role="dialog" aria-label="Wallet" className="absolute right-0 top-full z-40 mt-2 w-72 rounded-2xl border border-line bg-surface p-4 text-sm shadow-[0_12px_40px_rgba(14,26,48,0.16)]">
          {!isConnected ? (
            <>
              <div className="mb-2 text-xs font-medium text-muted">Choose a wallet</div>
              {options.length === 0 ? (
                <p className="text-xs leading-relaxed text-muted">No browser wallet detected. Install an EVM wallet extension and reload.</p>
              ) : (
                <ul className="space-y-1.5">
                  {options.map((c) => (
                    <li key={c.uid}>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => connect({ connector: c, chainId: CHAIN.id }, { onSuccess: () => setOpen(false) })}
                        className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left hover:border-accent/60 disabled:opacity-50"
                      >
                        {c.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.icon} alt="" width={20} height={20} className="rounded" />
                        ) : (
                          <span aria-hidden className="size-5 rounded bg-surface-2" />
                        )}
                        {c.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {error && <p role="alert" className="mt-2 text-xs text-loss">{error.message.split("\n")[0]}</p>}
              <p className="mt-3 text-[11px] leading-relaxed text-muted">Connecting only shares your public address. We never ask for a seed phrase or private key.</p>
            </>
          ) : (
            <>
              <div className="text-xs text-muted">Connected{connector ? ` with ${connector.name}` : ""}</div>
              <div className="num mt-1 break-all text-xs">{address}</div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xs text-muted">Balance</span>
                <span className="num text-sm">{balance ? `${Number(formatEther(balance.value)).toFixed(4)} ${balance.symbol}` : "…"}</span>
              </div>
              {wrongNetwork && (
                <button
                  type="button"
                  disabled={switching}
                  onClick={() => switchChain({ chainId: CHAIN.id })}
                  className="mt-3 w-full rounded-xl bg-warn-bg px-3 py-2 text-sm font-medium text-warn hover:brightness-95 disabled:opacity-50"
                >
                  {switching ? "Switching…" : `Switch to ${CHAIN.name}`}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="mt-3 w-full rounded-[4px] border border-line px-3 py-2 text-sm text-muted hover:text-fg"
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
