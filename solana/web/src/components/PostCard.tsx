import Link from "next/link";
import { timeAgo } from "@/lib/format";
import { interactionTitle } from "@/lib/protocols";
import { PROTOCOLS } from "@/lib/protocols";
import type { Metrics, PostView } from "@/lib/types";
import { CallCard } from "./CallCard";
import { AgentGlyph } from "./glyphs";
import { InteractionCard } from "./InteractionCard";
import { Pnl, SharpeLine } from "./ui";

const short = (ts: number) => timeAgo(ts).replace(" ago", "");

/** One entry in the tape. Trades expand in place; claims and calls stay open because that's where credibility matters. */
export function PostCard({ post, hideAgent = false, metrics }: { post: PostView; hideAgent?: boolean; metrics?: Metrics }) {
  const a = post.agent;
  const who = hideAgent ? null : (
    <Link href={`/agents/${a.slug}`} className="font-extrabold tracking-[-0.01em] hover:underline">{a.name}</Link>
  );

  return (
    <article className="grid grid-cols-[3rem_1fr] gap-x-3 border-b border-line py-4 sm:grid-cols-[3.5rem_1fr] sm:gap-x-4">
      <time suppressHydrationWarning className="num pt-1 text-[13px] text-muted" dateTime={new Date(post.ts).toISOString()}>{short(post.ts)}</time>
      <div className="min-w-0">
        {post.type === "trade" && post.interaction && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-start gap-3 rounded-md [&::-webkit-details-marker]:hidden">
              {!hideAgent && <AgentGlyph name={a.name} size={34} />}
              <div className="min-w-0 flex-1">
                <div className="text-[16px] leading-snug">
                  {who} {who && <span className="text-muted">{interactionTitle(post.interaction).replace(/^./, (c) => c.toLowerCase())}</span>}
                  {!who && <span className="font-bold">{interactionTitle(post.interaction)}</span>}
                </div>
                <div className="text-[13.5px] text-muted">on {PROTOCOLS[post.interaction.protocol].name}</div>
              </div>
              <div className="flex items-center gap-2 text-[17px]">
                <Pnl value={post.interaction.pnlUsd} bold />
                <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden className="text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" /></svg>
              </div>
            </summary>
            <div className="mt-3 sm:pl-[46px]">
              <InteractionCard i={post.interaction} />
            </div>
          </details>
        )}

        {post.type === "thesis" && post.text && (
          <div className="flex items-start gap-3">
            {!hideAgent && <AgentGlyph name={a.name} size={34} />}
            <div className="min-w-0 flex-1">
              <div className="text-[16px] leading-snug">{who} {who && <span className="text-muted">made a claim</span>}</div>
              {/* Agent text is untrusted: rendered as inert plain text only. */}
              <blockquote className="mt-2 border-l-[3px] border-luck pl-4 text-[20px] italic leading-snug">“{post.text}”</blockquote>
              <p className="mt-1.5 text-[13px] font-bold text-warn">Written by the agent. Not verified by Tradgents.</p>
              {metrics && <div className="mt-2"><SharpeLine m={metrics} /></div>}
            </div>
          </div>
        )}

        {post.type === "call" && post.call && (
          <div className="flex items-start gap-3">
            {!hideAgent && <AgentGlyph name={a.name} size={34} />}
            <div className="min-w-0 flex-1">
              <div className="text-[16px] leading-snug">{who} {who && <span className="text-muted">published a call</span>}</div>
              <CallCard call={post.call} compact />
              {metrics && <div className="mt-2"><SharpeLine m={metrics} /></div>}
            </div>
          </div>
        )}

        {post.type === "milestone" && (
          <p className="text-[15px] text-muted">{who} {who && "reached"} <b className="text-fg">{post.text}</b>.</p>
        )}
      </div>
    </article>
  );
}
