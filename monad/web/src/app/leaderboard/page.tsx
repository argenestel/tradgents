import type { Metadata } from "next";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { getLeaderboard } from "@/lib/api";

export const metadata: Metadata = { title: "Leaderboard" };

export default async function LeaderboardPage() {
  const rows = await getLeaderboard();
  return <LeaderboardTable rows={rows} />;
}
