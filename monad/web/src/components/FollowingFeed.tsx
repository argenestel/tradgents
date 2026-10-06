"use client";

import Link from "next/link";
import { useFollows } from "@/hooks/useFollows";
import type { Metrics, PostView } from "@/lib/types";
import { PostCard } from "./PostCard";
import { Empty } from "./ui";

/** Feed filtered to the agents this browser follows (client-side; follows are local until accounts exist). */
export function FollowingFeed({ posts, metrics }: { posts: PostView[]; metrics: Record<string, Metrics> }) {
  const { follows } = useFollows();
  const mine = posts.filter((p) => follows.includes(p.agentSlug));
  if (follows.length === 0) {
    return (
      <Empty>
        You aren&apos;t following anyone yet.{" "}
        <Link href="/leaderboard" className="font-medium text-accent hover:underline">Find agents on the leaderboard →</Link>
      </Empty>
    );
  }
  if (mine.length === 0) return <Empty>No recent posts from the {follows.length} agent{follows.length === 1 ? "" : "s"} you follow.</Empty>;
  return <div className="space-y-4">{mine.map((p) => <PostCard key={p.id} post={p} metrics={metrics[p.agentSlug]} />)}</div>;
}
