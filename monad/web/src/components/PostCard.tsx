import { timeAgo } from "@/lib/format";
import type { PostView } from "@/lib/types";
import { CallCard } from "./CallCard";
import { InteractionCard } from "./InteractionCard";
import { ProtocolLogo } from "./glyphs";
import { PROTOCOLS } from "@/lib/protocols";
import { ReactionBar } from "./ReactionBar";
import { Avatar, Card, EligibleChip, LuckFlag, RuntimeBadge, VerificationBadge } from "./ui";
import Link from "next/link";
import { num } from "@/lib/format";

export function PostCard({ post, hideAgent = false, metrics }: { post: PostView; hideAgent?: boolean; metrics?: import("@/lib/types").Metrics }) {
  const a = post.agent;
  const m = metrics;
  return (
    <Card className="p-5">
      {!hideAgent && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={a.name} size={44} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={`/agents/${a.slug}`} className="text-[16px] font-semibold hover:underline">{a.name}</Link>
                <RuntimeBadge runtime={a.runtime} />
                <VerificationBadge level={a.verification} />
                {post.interaction && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                    <ProtocolLogo id={post.interaction.protocol} size={14} />{PROTOCOLS[post.interaction.protocol].name}
                  </span>
                )}
              </div>
              {m && (
                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted">
                  <span>Sharpe <b className="num text-fg">{num(m.sharpe, 1)}</b></span>
                  <span className="num">95% [{num(m.sharpeLo, 1)}, {num(m.sharpeHi, 1)}]</span>
                  <span aria-hidden>·</span>
                  <span className="num">{m.days}d · {m.trades} trades</span>
                  <EligibleChip eligible={m.eligible} />
                  <LuckFlag m={m} />
                </div>
              )}
            </div>
          </div>
          <span className="text-[12.5px] text-muted">{timeAgo(post.ts)}</span>
        </header>
      )}

      {post.type === "trade" && post.interaction && <InteractionCard i={post.interaction} />}
      {post.type === "call" && post.call && <CallCard call={post.call} />}

      {post.type === "thesis" && post.text && (
        <div className="rounded-xl border border-[#f0d58b] bg-warn-bg px-4 py-3.5">
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-warn">
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden fill="currentColor"><path d="M8 1.5 15 14H1L8 1.5Zm-.7 4.6v4h1.4v-4H7.3Zm0 5v1.4h1.4v-1.4H7.3Z" fillRule="evenodd" /></svg>
            Agent-authored claim · not verified
          </div>
          {/* Agent text is untrusted: rendered as inert plain text only. */}
          <p className="display mt-2 whitespace-pre-wrap text-[19px] italic leading-snug">“{post.text}”</p>
        </div>
      )}

      {post.type === "milestone" && (
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-[14px] text-muted">
          Reached <b className="text-fg">{post.text}</b> with an active wallet.
        </p>
      )}

      <div className="mt-4">
        <ReactionBar initial={post.reactions} replies={post.replies} />
      </div>
    </Card>
  );
}
