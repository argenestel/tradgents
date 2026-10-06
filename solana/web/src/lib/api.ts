// Data access layer: the Tradgents API, nothing else. Pages fetch on the server and pass data down.
import { API_URL } from "./config";
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

export interface Meta {
  cluster: string;
  programId: string;
  pool: string;
  valuation: string;
}

export class DataServiceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DataServiceError";
  }
}

async function http<T>(path: string): Promise<T | null> {
  if (!API_URL) throw new DataServiceError("The data service isn't configured. Set API_URL.");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { next: { revalidate: 5 }, headers: { accept: "application/json" } });
  } catch {
    throw new DataServiceError("Can't reach the data service.");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new DataServiceError(`The data service returned ${res.status}.`, res.status);
  return (await res.json()) as T;
}

export async function getMeta(): Promise<Meta> {
  const m = await http<Partial<Meta>>("/v1/meta").catch(() => null);
  return {
    cluster: m?.cluster ?? "devnet",
    programId: m?.programId ?? "",
    pool: m?.pool ?? "",
    valuation: m?.valuation ?? "devUSDC at Orca devnet pool price",
  };
}

export const getLeaderboard = async (): Promise<LeaderboardRow[]> => (await http<LeaderboardRow[]>("/v1/leaderboard")) ?? [];
export const getAgentList = async (): Promise<Agent[]> => (await getLeaderboard()).map((r) => r.agent);
export const getAgent = (slug: string) => http<AgentDetail>(`/v1/agents/${encodeURIComponent(slug)}`);

export async function getFeed(opts: { agentSlug?: string; filter?: FeedFilter; limit?: number } = {}): Promise<PostView[]> {
  const q = new URLSearchParams();
  if (opts.agentSlug) q.set("agent", opts.agentSlug);
  if (opts.filter && opts.filter !== "all") q.set("filter", opts.filter);
  q.set("limit", String(Math.min(200, Math.max(1, opts.limit ?? 40))));
  return (await http<PostView[]>(`/v1/feed?${q}`)) ?? [];
}

export const getCalls = async (agentSlug?: string): Promise<Call[]> =>
  (await http<Call[]>(`/v1/calls${agentSlug ? `?agent=${encodeURIComponent(agentSlug)}` : ""}`)) ?? [];

export const getProtocolPage = (id: ProtocolId) => http<ProtocolPage>(`/v1/protocols/${encodeURIComponent(id)}`);
export const getProtocolMatrix = async (): Promise<ProtocolPage[]> => (await http<ProtocolPage[]>("/v1/protocols")) ?? [];
