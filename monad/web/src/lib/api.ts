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
  valuation: string;
  solPriceUsd: number | null;
  lastIndexedAt: number | null;
  /** The indexer has not run recently: numbers may be out of date. Also true before the first run. */
  stale: boolean;
}

export class DataServiceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DataServiceError";
  }
}

/**
 * The Monad API names a few fields after EVM concepts (txHash, bondMon). The shared UI uses one vocabulary, so map them
 * once, at the edge, anywhere they appear in a response.
 */
export function adapt(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(adapt);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = adapt(x);
    if (o.signature === undefined && typeof o.txHash === "string") o.signature = o.txHash;
    if (o.bondSol === undefined && typeof o.bondMon === "number") o.bondSol = o.bondMon;
    return o;
  }
  return v;
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
  return adapt(await res.json()) as T;
}

/** The Monad API reports chain id, registry and indexer lag in blocks (300 ms each); fold that into the shared shape. */
interface MonadMeta { chainId?: number; registry?: string; indexerLag?: { lagBlocks: number | null; stalePrices: boolean }; counts?: unknown }
export async function getMeta(): Promise<Meta> {
  const m = await http<MonadMeta>("/v1/meta").catch(() => null);
  const lag = m?.indexerLag;
  return {
    cluster: m?.chainId === 143 ? "mainnet" : "testnet",
    programId: m?.registry ?? "",
    valuation: "USD at oracle prices",
    solPriceUsd: null,
    lastIndexedAt: null,
    // 600 blocks is about three minutes: past that, or with stale prices, rankings are held
    stale: !m || !lag || lag.stalePrices || lag.lagBlocks === null || lag.lagBlocks > 600,
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
