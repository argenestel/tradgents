// Data access layer. Reads the Tradgents API when API_URL is set, otherwise the in-memory
// simulated dataset. Page code is identical in both modes.
import { API_URL, DATA_SOURCE } from "./config";
import { PROTOCOLS } from "./protocols";
import type { Agent, AgentDetail, Call, LeaderboardRow, PnlComponent, PostView, ProtocolId, ProtocolStat } from "./types";

export type FeedFilter = "all" | "calls" | "trades" | "thesis";

export interface ProtocolPage {
  protocol: ProtocolId;
  agents: { slug: string; name: string; stat: ProtocolStat }[];
  waterfall: { label: PnlComponent; usd: number }[];
  totalPnl: number;
  totalTrades: number;
  kinds: { kind: string; trades: number; pnlUsd: number }[];
}

export class DataServiceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DataServiceError";
  }
}

async function http<T>(path: string): Promise<{ data: T | null; demo: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { next: { revalidate: 10 }, headers: { accept: "application/json" } });
  } catch {
    throw new DataServiceError("Can't reach the data service.");
  }
  if (res.status === 404) return { data: null, demo: false };
  if (!res.ok) throw new DataServiceError(`Data service returned ${res.status}.`, res.status);
  return { data: (await res.json()) as T, demo: res.headers.get("x-demo-data") === "true" };
}

const mock = () => import("./mock/seed").then((m) => m.DB);

/** Where the data came from and whether any of it is simulated. */
export async function getMeta(): Promise<{ source: "api" | "mock"; demo: boolean }> {
  if (DATA_SOURCE === "mock") return { source: "mock", demo: true };
  const { demo } = await http<LeaderboardRow[]>("/v1/leaderboard");
  return { source: "api", demo };
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  if (DATA_SOURCE === "api") return (await http<LeaderboardRow[]>("/v1/leaderboard")).data ?? [];
  const DB = await mock();
  return [...DB.agents.values()].map((d) => ({
    agent: d.agent,
    equityUsd: d.equityUsd,
    tier: d.tier,
    metrics: d.metrics,
    spark: d.equity.slice(-30).map((p, _i, arr) => (p.usd / arr[0].usd) * 100),
  }));
}

export async function getAgentList(): Promise<Agent[]> {
  return (await getLeaderboard()).map((r) => r.agent);
}

export async function getAgent(slug: string): Promise<AgentDetail | null> {
  if (DATA_SOURCE === "api") return (await http<AgentDetail>(`/v1/agents/${encodeURIComponent(slug)}`)).data;
  return (await mock()).agents.get(slug) ?? null;
}

export async function getFeed(opts: { agentSlug?: string; filter?: FeedFilter; limit?: number } = {}): Promise<PostView[]> {
  if (DATA_SOURCE === "api") {
    const q = new URLSearchParams();
    if (opts.agentSlug) q.set("agent", opts.agentSlug);
    if (opts.filter && opts.filter !== "all") q.set("filter", opts.filter);
    q.set("limit", String(Math.min(200, Math.max(1, opts.limit ?? 40))));
    return (await http<PostView[]>(`/v1/feed?${q}`)).data ?? [];
  }
  const DB = await mock();
  let posts = DB.posts;
  if (opts.agentSlug) posts = posts.filter((p) => p.agentSlug === opts.agentSlug);
  if (opts.filter === "calls") posts = posts.filter((p) => p.type === "call");
  if (opts.filter === "trades") posts = posts.filter((p) => p.type === "trade");
  if (opts.filter === "thesis") posts = posts.filter((p) => p.type === "thesis");
  return posts.slice(0, opts.limit ?? 40).map((p) => ({
    ...p,
    agent: DB.agents.get(p.agentSlug)!.agent,
    interaction: p.interactionId ? DB.interactions.get(p.interactionId) : undefined,
    call: p.callId ? DB.calls.find((c) => c.id === p.callId) : undefined,
  }));
}

export async function getCalls(agentSlug?: string): Promise<Call[]> {
  if (DATA_SOURCE === "api") return (await http<Call[]>(`/v1/calls${agentSlug ? `?agent=${encodeURIComponent(agentSlug)}` : ""}`)).data ?? [];
  const DB = await mock();
  return agentSlug ? DB.calls.filter((c) => c.agentSlug === agentSlug) : DB.calls;
}

export async function getProtocolPage(id: ProtocolId): Promise<ProtocolPage | null> {
  if (!PROTOCOLS[id]) return null;
  if (DATA_SOURCE === "api") return (await http<ProtocolPage>(`/v1/protocols/${encodeURIComponent(id)}`)).data;
  const DB = await mock();
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

export async function getProtocolMatrix(): Promise<ProtocolPage[]> {
  if (DATA_SOURCE === "api") return (await http<ProtocolPage[]>("/v1/protocols")).data ?? [];
  const rows = await Promise.all((Object.keys(PROTOCOLS) as ProtocolId[]).map((id) => getProtocolPage(id)));
  return rows.filter((r): r is ProtocolPage => !!r);
}
