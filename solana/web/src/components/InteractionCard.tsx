import { EXPLORER, isDemoRef } from "@/lib/config";
import { MOCK_NOW, num, shortAddr, timeAgo, usd } from "@/lib/format";
import { PROTOCOLS, interactionTitle } from "@/lib/protocols";
import type { Interaction } from "@/lib/types";
import { CopyPanel } from "./CopyPanel";
import { CopyText } from "./CopyText";
import { ProtocolLogo, TokenIcon } from "./glyphs";
import { Pct, Pnl } from "./ui";

const cost = (i: Interaction, ...labels: string[]) => i.components.filter((c) => labels.includes(c.label)).reduce((a, c) => a + Math.min(0, c.usd), 0);

/** What the transaction did, computed from the chain. No agent prose lives in here. */
export function InteractionCard({ i, showTime = false }: { i: Interaction; showTime?: boolean }) {
  const p = PROTOCOLS[i.protocol];
  const title = interactionTitle(i);
  const copyable = i.protocol === "jupiter" && i.kind === "swap";
  const [from, to] = [i.legs[0]?.symbol ?? "?", i.legs[1]?.symbol ?? "?"];
  const retPct = i.notionalUsd ? (i.pnlUsd / i.notionalUsd) * 100 : 0;
  const fees = cost(i, "swapFee", "borrowCost");
  const priority = cost(i, "priorityFee");
  const tip = cost(i, "tip");
  const demo = isDemoRef(i.signature);

  return (
    <article aria-label={title} className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-[13px] text-muted">
        <span>Computed from the transaction</span>
        <span className="inline-flex items-center gap-1.5 font-bold text-fg"><ProtocolLogo id={i.protocol} size={18} />{p.name}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-4 py-4 sm:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
          <div className="text-center"><TokenIcon symbol={from} size={36} /><div className="mt-1 text-[12px] font-semibold">{from}</div></div>
          <span aria-hidden className="text-muted">to</span>
          <div className="text-center"><TokenIcon symbol={to} size={36} /><div className="mt-1 text-[12px] font-semibold">{to}</div></div>
        </div>
        <div>
          <div className="text-[13px] font-semibold text-muted">Size</div>
          <div className="num text-[20px] font-extrabold leading-tight tracking-[-0.02em]">{usd(i.notionalUsd)}</div>
          <div className="num text-[12.5px] text-muted">{num(Math.abs(i.legs[0]?.delta ?? 0), Math.abs(i.legs[0]?.delta ?? 0) < 10 ? 3 : 1)} {from}</div>
        </div>
        <div>
          <div className="text-[13px] font-semibold text-muted">Realized</div>
          <div className="text-[20px] font-extrabold leading-tight tracking-[-0.02em]"><Pnl value={i.pnlUsd} bold /></div>
          <div className="text-[13px]"><Pct value={retPct} /></div>
        </div>
        <dl className="num text-[13px]">
          <dt className="mb-0.5 font-sans text-[13px] font-semibold text-muted">Costs</dt>
          {[["Fees", fees], ["Priority", priority], ["Jito tip", tip]].map(([k, v]) => (
            <div key={k as string} className="flex justify-between gap-3"><dd className="font-sans text-muted">{k}</dd><dd>{usd(v as number)}</dd></div>
          ))}
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[13px] text-muted">
        <span>Transaction</span>
        {demo ? (
          <span title="Simulated signature, not a real transaction"><CopyText value={i.signature} display={shortAddr(i.signature)} label="signature" /> <span className="font-semibold text-warn">simulated</span></span>
        ) : (
          <span className="inline-flex items-center gap-1"><CopyText value={i.signature} display={shortAddr(i.signature)} label="signature" className="text-accent" /><a href={EXPLORER.tx(i.signature)} target="_blank" rel="noopener noreferrer" className="font-bold text-accent" aria-label="Open in explorer">Explorer</a></span>
        )}
        {showTime && <span>{timeAgo(i.ts)}</span>}
        <span className="ml-auto">
          {copyable ? (
            <CopyPanel pair={i.meta.pair ?? "SOL/USDC"} agentNotionalUsd={i.notionalUsd} ageMinutes={Math.max(1, (MOCK_NOW - i.ts) / 60000)} />
          ) : (
            <span className="inline-block py-2" title="Copying is available for spot swaps for now">Can&apos;t copy yet</span>
          )}
        </span>
      </div>
    </article>
  );
}
