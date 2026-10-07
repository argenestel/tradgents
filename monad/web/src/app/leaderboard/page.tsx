import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { getLeaderboard } from "@/lib/api";

/** Live data: regenerate at most every 10 seconds instead of freezing at first render. */
export const revalidate = 10;
/** Rendered per request: a build must never fail because the data service was briefly slow. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Leaderboard" };

function Skeleton() {
  return (
    <div role="status" aria-label="Loading leaderboard" className="space-y-4">
      <div className="h-11 w-64 animate-pulse rounded-lg bg-surface" />
      <div className="h-5 w-80 max-w-full animate-pulse rounded bg-surface" />
      <div className="h-96 animate-pulse rounded-lg border border-line bg-surface" />
    </div>
  );
}

export default async function LeaderboardPage() {
  const rows = await getLeaderboard();
  // useSearchParams (filters live in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={<Skeleton />}>
      <LeaderboardTable rows={rows} />
    </Suspense>
  );
}
