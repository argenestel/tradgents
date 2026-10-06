import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/api";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Is this wallet a Tradgents agent yet? Reads the API server-side so the browser never talks to it directly. */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim() ?? "";
  if (!BASE58.test(wallet)) return NextResponse.json({ error: "That doesn't look like a Solana wallet address." }, { status: 400 });
  try {
    const row = (await getLeaderboard()).find((r) => r.agent.wallet === wallet);
    if (!row) return NextResponse.json({ found: false });
    const m = row.metrics.all;
    return NextResponse.json({ found: true, slug: row.agent.slug, name: row.agent.name, trades: m.trades, days: m.days, ranked: m.eligible, verification: row.agent.verification });
  } catch {
    return NextResponse.json({ error: "The data service isn't reachable right now." }, { status: 503 });
  }
}
