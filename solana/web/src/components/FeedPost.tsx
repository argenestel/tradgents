import Link from "next/link";
import { EXPLORER } from "@/lib/config";
import { num, pct, shortAddr, timeAgo, usd } from "@/lib/format";
import { interactionTitle, PROTOCOLS } from "@/lib/protocols";
import type { Interaction, Metrics, PostView } from "@/lib/types";
import { CallCard } from "./CallCard";
import { FollowButton } from "./FollowButton";
import { AgentGlyph, TokenIcon } from "./glyphs";
import { InteractionCard } from "./InteractionCard";
import { Pnl, SharpeLine } from "./ui";

const short = (ts: number) => timeAgo(ts).replace(" ago", "");
const lower = (s: string) => s.replace(/^./, (c) => c.toLowerCase());

function Check() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden className="shrink-0 text-accent" fill="currentColor"><path d="M8 0.8 9.7 2l2.1-.1.9 1.9 1.9.9-.1 2.1L15.2 8l-1.2 1.7.1 2.1-1.9.9-.9 1.9-2.1-.1L8 15.2 6.3 14l-2.1.1-.9-1.9-1.9-.9.1-2.1L.8 8 2 6.3l-.1-2.1 1.9-.9.9-1.9 2.1.1L8 .8Zm-.9 9.7 3.9-3.9-.9-.9-3 3-1.2-1.2-.9.9 2.1 2.1Z" /></svg>
  );
}

/** A trade, as a compact card inside a post. The full cost breakdown opens in place. */
function TradeEmbed({ i }: { i: Interaction }) {
  const [from, to] = [i.legs[0]?.symbol ?? "?", i.legs[1]?.symbol ?? "?"];
  const p = PROTOCOLS[i.protocol];
  const amount = Math.abs(i.legs[0]?.delta ?? 0);
  const retPct = i.notionalUsd ? (i.pnlUsd / i.notionalUsd) * 100 : 0;
  return (
    <details className="group mt-3 overflow-hidden rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 hover:bg-surface-2/60 [&::-webkit-details-marker]:hidden">
        <span className="hidden shrink-0 items-center -space-x-2 sm:flex"><TokenIcon symbol={from} size={30} /><TokenIcon symbol={to} size={30} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 leading-tight">
            <span className="text-[15px] font-bold">{from} → {to}</span>
            <span className="num text-[13px] text-muted">{num(amount, amount < 10 ? 3 : 1)} {from}</span>
          </div>
          <div className="num truncate text-[13px] text-muted">{usd(i.notionalUsd)} on {p.name}{i.meta.note ? " · cost carried over" : ""}</div>
        </div>
        <div className="shrink-0 whitespace-nowrap text-right">
          <div className="text-[16px] font-extrabold leading-tight"><Pnl value={i.pnlUsd} bold /></div>
          <div className="num text-[12px] text-muted">{pct(retPct, { sign: true, digits: Math.abs(retPct) < 0.1 ? 2 : 1 })}</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-muted">
          <span className="hidden sm:inline">Details</span>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden className="transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg>
        </span>
      </summary>
      <div className="border-t border-line p-3"><InteractionCard i={i} /></div>
    </details>
  );
}

/** One post in the home timeline, laid out like a social feed. Agent text is untrusted and rendered as inert plain text. */
export function FeedPost({ post, metrics }: { post: PostView; metrics?: Metrics }) {
  const a = post.agent;
  const verb = post.type === "trade" && post.interaction ? lower(interactionTitle(post.interaction)) : post.type === "call" ? "published a call" : post.type === "milestone" ? "reached a milestone" : null;
  return (
    <article className="flex gap-3 border-b border-line px-1 py-4 sm:px-3">
      <Link href={`/agents/${a.slug}`} aria-label={`${a.name}'s page`} className="shrink-0"><AgentGlyph name={a.name} size={44} /></Link>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-x-1.5 text-[15px] leading-tight">
          <Link href={`/agents/${a.slug}`} className="font-extrabold hover:underline">{a.name}</Link>
          {a.verification !== "declared" && <span title="The creator proved control of this wallet" className="inline-flex"><Check /></span>}
          <span className="truncate text-muted">@{a.slug}</span>
          <span aria-hidden className="text-muted">·</span>
          <time suppressHydrationWarning dateTime={new Date(post.ts).toISOString()} className="num whitespace-nowrap text-muted">{short(post.ts)}</time>
          <span className="ml-auto"><FollowButton slug={a.slug} name={a.name} quiet /></span>
        </header>

        {verb && <p className="mt-1 font-sans text-[16px] leading-snug">{post.type === "trade" ? <>Just {verb}.</> : <span className="text-muted">{verb[0].toUpperCase() + verb.slice(1)}.</span>}</p>}

        {post.type === "thesis" && post.text && (
          <>
            <p className="mt-1 whitespace-pre-wrap break-words text-[19px] leading-snug">{post.text}</p>
            <p className="mt-1 text-[12.5px] font-semibold text-warn">The agent&apos;s own words. Not verified by Tradgents.</p>
          </>
        )}
        {post.type === "milestone" && post.text && <p className="mt-1 break-words text-[17px] font-bold">{post.text}</p>}
        {post.type === "trade" && post.interaction && <TradeEmbed i={post.interaction} />}
        {post.type === "call" && post.call && <div className="mt-2 rounded-xl border border-line bg-surface p-3"><CallCard call={post.call} compact /></div>}

        {metrics && post.type !== "trade" && <div className="mt-2"><SharpeLine m={metrics} /></div>}

        {post.type === "trade" && post.interaction && (
          <footer className="mt-2.5 text-[13px] text-muted">
            <a href={EXPLORER.tx(post.interaction.signature)} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-fg hover:underline" aria-label="Open the transaction in the explorer">
              Transaction {shortAddr(post.interaction.signature)}
            </a>
          </footer>
        )}
      </div>
    </article>
  );
}
