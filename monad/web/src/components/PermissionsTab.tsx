import { ACCOUNT_TYPES, PROTOCOLS, VERIFICATION } from "@/lib/protocols";
import { EXPLORER, IS_DEMO } from "@/lib/config";
import { DAY, MOCK_NOW, dateLabel, shortAddr, usd } from "@/lib/format";
import type { Agent, Approval } from "@/lib/types";
import { Card, SectionTitle } from "./ui";

const RISK: Record<Approval["risk"], { label: string; cls: string }> = {
  low: { label: "Low", cls: "border-gain/40 text-gain" },
  medium: { label: "Medium", cls: "border-warn/40 text-warn" },
  high: { label: "⚠ High", cls: "border-loss/50 text-loss" },
};

function Addr({ a }: { a: string }) {
  return IS_DEMO ? (
    <span className="num" title="Demo address">{shortAddr(a)} <span className="text-warn">(demo)</span></span>
  ) : (
    <a href={EXPLORER.address(a)} target="_blank" rel="noopener noreferrer" className="num underline">{shortAddr(a)}</a>
  );
}

/** What this agent is *allowed* to do — as important as what it did. */
export function PermissionsTab({ agent }: { agent: Agent }) {
  const acct = ACCOUNT_TYPES[agent.accountType];
  const p = agent.policy;
  const daysLeft = (p.expiresAt - MOCK_NOW) / DAY;
  const usedPct = p.dailyCapUsd ? Math.min(100, (p.usedTodayUsd / p.dailyCapUsd) * 100) : 0;
  const hasHighRisk = agent.approvals.some((a) => a.risk === "high");

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle>Account &amp; identity</SectionTitle>
          <dl className="grid grid-cols-[130px_1fr] gap-x-4 gap-y-3 text-sm">
            <dt className="text-muted">Account type</dt>
            <dd>
              <span className="rounded-[3px] border border-line px-2 py-0.5 text-xs">{acct.label}</span>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">{acct.hint}</p>
            </dd>
            <dt className="text-muted">Agent address</dt>
            <dd><Addr a={agent.wallet} /></dd>
            <dt className="text-muted">Owner</dt>
            <dd><Addr a={agent.owner} /></dd>
            <dt className="text-muted">Verification</dt>
            <dd>
              {VERIFICATION[agent.verification].label}
              <p className="mt-1 text-xs text-muted">{VERIFICATION[agent.verification].hint}</p>
            </dd>
            <dt className="text-muted">On-chain identity</dt>
            <dd>
              {agent.erc8004Id ? (
                <span className="num">ERC-8004 #{agent.erc8004Id}</span>
              ) : (
                <span className="text-muted">Not registered</span>
              )}
            </dd>
          </dl>
        </Card>

        <Card className="p-5">
          <SectionTitle aside={p.status === "expiring" ? <span className="text-warn">expires soon</span> : undefined}>Session-key policy</SectionTitle>
          {p.status === "none" ? (
            <div role="alert" className="rounded-[4px] border border-loss/40 bg-loss/10 p-3 text-sm text-loss">
              ⚠ <strong>No spending policy.</strong> This agent signs with a full-power key. Anyone who compromises it — or any bug in the agent — can move all funds in the wallet.
            </div>
          ) : (
            <>
              <p className="rounded-[4px] bg-surface-2 p-3 text-sm leading-relaxed">
                This agent can trade only on{" "}
                <strong>{p.allowedProtocols.map((id) => PROTOCOLS[id].name).join(", ")}</strong>, up to{" "}
                <strong className="num">{usd(p.perTradeCapUsd)}</strong> per trade and{" "}
                <strong className="num">{usd(p.dailyCapUsd)}</strong> per day, until{" "}
                <strong>{dateLabel(p.expiresAt)}</strong> ({Math.max(0, Math.round(daysLeft))}d left).
              </p>
              <div className="mt-4">
                <div className="mb-1.5 flex justify-between text-xs text-muted">
                  <span>Used today</span>
                  <span className="num">{usd(p.usedTodayUsd)} / {usd(p.dailyCapUsd)}</span>
                </div>
                <div className="h-2 rounded bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usedPct)} aria-label="Daily cap used">
                  <div className={`h-2 rounded ${usedPct > 85 ? "bg-warn" : "bg-accent"}`} style={{ width: `${usedPct}%` }} />
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-2 text-[11px] uppercase tracking-wider text-muted">Policy history</div>
                <ul className="space-y-1.5 text-xs text-muted">
                  {p.changes.map((c) => (
                    <li key={c.ts + c.text} className="flex justify-between gap-3">
                      <span>{c.text}</span>
                      <span className="num shrink-0">{dateLabel(c.ts)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <div className="px-5 pt-5">
          <SectionTitle aside="what the agent can pull from its wallet">Token approvals</SectionTitle>
          {hasHighRisk && (
            <p role="alert" className="mb-3 rounded-[4px] border border-loss/40 bg-loss/10 px-3 py-2 text-xs text-loss">
              ⚠ Unlimited approval to an unlabeled contract. Treat funds in this wallet as at risk.
            </p>
          )}
        </div>
        <table className="w-full min-w-[620px] text-sm">
          <caption className="sr-only">Token approvals</caption>
          <thead>
            <tr className="border-y border-line text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="px-5 py-2.5">Token</th>
              <th className="px-5 py-2.5">Spender</th>
              <th className="px-5 py-2.5 text-right">Amount</th>
              <th className="px-5 py-2.5 text-right">Risk</th>
            </tr>
          </thead>
          <tbody>
            {agent.approvals.map((a) => (
              <tr key={a.spender} className="border-b border-line last:border-0">
                <td className="px-5 py-3">{a.token}</td>
                <td className="px-5 py-3">
                  {a.spenderLabel ?? <span className="text-loss">Unlabeled contract</span>}
                  <div className="text-[11px] text-muted"><Addr a={a.spender} /></div>
                </td>
                <td className="num px-5 py-3 text-right">{a.amountUsd === "unlimited" ? <span className="text-warn">Unlimited</span> : usd(a.amountUsd)}</td>
                <td className="px-5 py-3 text-right">
                  <span className={`rounded-[3px] border px-2 py-0.5 text-[11px] ${RISK[a.risk].cls}`}>{RISK[a.risk].label}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[11px] text-muted">
          Spender labels come from a curated registry; contracts we can&apos;t label are shown as unlabeled. Bond: {agent.bondMon ? `${agent.bondMon} MON escrowed` : "not posted"}.
        </p>
      </Card>
    </div>
  );
}
