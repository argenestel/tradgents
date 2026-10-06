// Data access layer. Today it reads the in-memory demo DB; when the backend
// exists, replace the bodies with fetch() calls — page code should not change.
import { DB } from "./mock/seed";
import { PROTOCOLS } from "./protocols";
import type { AgentDetail, Call, LeaderboardRow, PnlComponent, PostView, ProtocolId, ProtocolStat } from "./types";

export const IS_DEMO = true;

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  return [...DB.agents.values()].map((d) => ({
    agent: d.agent,
    equityUsd: d.equityUsd,
    tier: d.tier,
    metrics: d.metrics,
    spark: d.equity.slice(-30).map((p, _i, arr) => (p.usd / arr[0].usd) * 100),
  }));
}

export async function getAgent(slug: string): Promise<AgentDetail | null> {
  return DB.agents.get(slug) ?? null;
}

export async function getAgents(): Promise<AgentDetail[]> {
  return [...DB.agents.values()];
}

function toView(p: (typeof DB.posts)[number]): PostView {
  return {
    ...p,
    agent: DB.agents.get(p.agentSlug)!.agent,
    interaction: p.interactionId ? DB.interactions.get(p.interactionId) : undefined,
    call: p.callId ? DB.calls.find((c) => c.id === p.callId) : undefined,
  };
}

export type FeedFilter = "all" | "calls" | "trades" | "thesis";

export async function getFeed(opts: { agentSlug?: string; filter?: FeedFilter; limit?: number } = {}): Promise<PostView[]> {
  let posts = DB.posts;
  if (opts.agentSlug) posts = posts.filter((p) => p.agentSlug === opts.agentSlug);
  if (opts.filter === "calls") posts = posts.filter((p) => p.type === "call");
  if (opts.filter === "trades") posts = posts.filter((p) => p.type === "trade");
  if (opts.filter === "thesis") posts = posts.filter((p) => p.type === "thesis");
  return posts.slice(0, opts.limit ?? 40).map(toView);
}

export async function getCalls(agentSlug?: string): Promise<Call[]> {
  return agentSlug ? DB.calls.filter((c) => c.agentSlug === agentSlug) : DB.calls;
}

export interface ProtocolPage {
  protocol: ProtocolId;
  agents: { slug: string; name: string; stat: ProtocolStat }[];
  waterfall: { label: PnlComponent; usd: number }[];
  totalPnl: number;
  totalTrades: number;
  kinds: { kind: string; trades: number; pnlUsd: number }[];
}

export async function getProtocolPage(id: ProtocolId): Promise<ProtocolPage | null> {
  if (!PROTOCOLS[id]) return null;
  const agents: ProtocolPage["agents"] = [];
  const wf = new Map<PnlComponent, number>();
  const kinds = new Map<string, { trades: number; pnlUsd: number }>();
  for (const d of DB.agents.values()) {
    const stat = d.byProtocol.find((s) => s.protocol === id);
    if (stat) agents.push({ slug: d.agent.slug, name: d.agent.name, stat });
    for (const i of d.interactions) {
      if (i.protocol !== id) continue;
      for (const c of i.components) wf.set(c.label, (wf.get(c.label) ?? 0) + c.usd);
      const k = kinds.get(i.kind) ?? { trades: 0, pnlUsd: 0 };
      k.trades++;
      k.pnlUsd += i.pnlUsd;
      kinds.set(i.kind, k);
    }
  }
  agents.sort((a, b) => b.stat.pnlUsd - a.stat.pnlUsd);
  return {
    protocol: id,
    agents,
    waterfall: [...wf.entries()].map(([label, usd]) => ({ label, usd })),
    totalPnl: agents.reduce((a, x) => a + x.stat.pnlUsd, 0),
    totalTrades: agents.reduce((a, x) => a + x.stat.trades, 0),
    kinds: [...kinds.entries()].map(([kind, v]) => ({ kind, ...v })),
  };
}

export async function getProtocolMatrix() {
  const rows = await Promise.all((Object.keys(PROTOCOLS) as ProtocolId[]).map((id) => getProtocolPage(id)));
  return rows.filter((r): r is ProtocolPage => !!r);
}
