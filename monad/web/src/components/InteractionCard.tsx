import Link from "next/link";
import { EXPLORER, IS_DEMO } from "@/lib/config";
import { MOCK_NOW, num, shortAddr, timeAgo, usd } from "@/lib/format";
import { PROTOCOLS, SPENDER_LABEL, interactionMeta, interactionTitle } from "@/lib/protocols";
import type { Interaction } from "@/lib/types";
import { CopyPanel } from "./CopyPanel";
import { ProtocolLogo, TokenIcon } from "./glyphs";
import { CopyText } from "./CopyText";
import { Pct, Pnl } from "./ui";

const cost = (i: Interaction, ...labels: string[]) => i.components.filter((c) => labels.includes(c.label)).reduce((a, c) => a + Math.min(0, c.usd), 0);

function DocIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M4 1.8h5.2L12.5 5v9.2H4V1.8Z" />
      <path d="M9 1.8V5h3.5M6 8.2h4M6 10.8h4" strokeLinecap="round" />
    </svg>
  );
}

/** Registry-driven trade card: platform-computed facts only (no agent prose). Unknown kinds still render legs + PnL. */
export function InteractionCard({ i, showTime = false }: { i: Interaction; showTime?: boolean }) {
  const p = PROTOCOLS[i.protocol];
  const title = interactionTitle(i);
  const copyable = !!interactionMeta(i.protocol, i.kind)?.copyable;
  const [from, to] = [i.legs[0]?.symbol ?? "—", i.legs[1]?.symbol ?? "—"];
  const retPct = i.notionalUsd ? (i.pnlUsd / i.notionalUsd) * 100 : 0;
  const fees = cost(i, "swapFee", "borrowCost");
  const gas = cost(i, "gas");
  const mev = cost(i, "mevLeak");

  return (
    <article aria-label={title}>
      <h3 className="text-[17px] font-semibold leading-snug">{title}</h3>
      <div className="mt-3 overflow-hidden rounded-xl border border-line">
        <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2 text-[12.5px] text-muted">
          <span className="flex items-center gap-2"><DocIcon /> Platform-computed trade</span>
          <span className="flex items-center gap-1.5 font-medium text-accent"><ProtocolLogo id={i.protocol} size={18} />{p.name}</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-[1.2fr_1fr_1fr_1fr] sm:items-center">
          <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
            <div className="text-center">
              <TokenIcon symbol={from} size={38} />
              <div className="mt-1 text-[12px] font-medium">{from}</div>
            </div>
            <span aria-hidden className="text-muted">→</span>
            <div className="text-center">
              <TokenIcon symbol={to} size={38} />
              <div className="mt-1 text-[12px] font-medium">{to}</div>
            </div>
          </div>
          <div>
            <div className="text-[12px] text-muted">Size</div>
            <div className="num mt-1 text-[18px] font-semibold">{usd(i.notionalUsd)}</div>
            <div className="num text-[12px] text-muted">{num(Math.abs(i.legs[0]?.delta ?? 0), Math.abs(i.legs[0]?.delta ?? 0) < 10 ? 3 : 1)} {from}</div>
          </div>
          <div>
            <div className="text-[12px] text-muted">Realized PnL</div>
            <div className="mt-1 text-[18px] font-semibold"><Pnl value={i.pnlUsd} bold /></div>
            <div className="text-[13px]"><Pct value={retPct} /></div>
          </div>
          <dl className="num text-[12.5px]">
            <div className="mb-0.5 text-[12px] text-muted font-sans">Costs</div>
            {[["Fees", fees], ["Gas", gas], ["MEV est.", mev]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-3"><dt className="text-muted font-sans">{k}</dt><dd>{usd(v as number)}</dd></div>
            ))}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
          <span>Tx</span>
          {IS_DEMO ? (
            <span className="text-accent" title="Demo hash — not a real transaction"><CopyText value={i.txHash} display={shortAddr(i.txHash)} label="transaction hash" /> <span className="text-warn">(demo)</span></span>
          ) : (
            <span className="inline-flex items-center gap-1"><CopyText value={i.txHash} display={shortAddr(i.txHash)} label="transaction hash" className="text-accent" /><a href={EXPLORER.tx(i.txHash)} target="_blank" rel="noopener noreferrer" className="text-accent" aria-label="Open in explorer">↗</a></span>
          )}
          {showTime && <span>· {timeAgo(i.ts)}</span>}
          <span className="ml-auto">
            {copyable ? (
              <CopyPanel pair={i.meta.pair ?? "MON/USDC"} protocol={p.name} spender={SPENDER_LABEL[i.protocol]} agentNotionalUsd={i.notionalUsd} ageMinutes={Math.max(1, (MOCK_NOW - i.ts) / 60000)} />
            ) : (
              <Link href={`/explore/${i.protocol}`} className="inline-block py-2 text-muted hover:text-fg" title="Copy is available for spot swaps in v1">view only</Link>
            )}
          </span>
        </div>
      </div>
    </article>
  );
}
