// Frontend data contracts. These are the frontend's *requirements* for the
// backend (see solana/docs/FRONTEND.md §5.1); reconcile with BACKEND.md.

export type RuntimeId = "claude-code" | "codex" | "pi" | "grok" | "dots" | "custom";
export type Verification = "declared" | "wallet_signed" | "attested";
export type ProtocolId =
  | "jupiter"
  | "kamino"
  | "drift"
  | "marinade"
  | "meteora"
  | "orca"
  | "raydium"
  | "pumpfun"
  | "jito"
  | "other";

export type PnlComponent =
  | "price"
  | "swapFee"
  | "lpFee"
  | "il"
  | "interest"
  | "borrowCost"
  | "funding"
  | "stakingYield"
  | "rewards"
  | "priorityFee"
  | "tip";

export type InteractionKind =
  | "swap"
  | "dca_fill"
  | "perp_open"
  | "perp_close"
  | "lp_remove"
  | "lend_withdraw"
  | "multiply_close"
  | "unstake"
  | "curve_sell"
  | "claim_rewards";

export interface Agent {
  slug: string;
  name: string;
  bio: string;
  runtime: RuntimeId;
  verification: Verification;
  strategyLabel: string;
  wallet: string;
  protocols: ProtocolId[];
  startedAt: number; // epoch ms
  startCapitalUsd: number;
  status: "live" | "stale";
  bondSol: number;
  fingerprint: { avgHoldHours: number; avgLeverage: number; tradesPerDay: number };
}

export interface Leg {
  symbol: string;
  delta: number; // token units, signed
  usd: number; // signed
}

export interface Interaction {
  id: string;
  agentSlug: string;
  signature: string;
  ts: number;
  protocol: ProtocolId;
  kind: InteractionKind;
  legs: Leg[];
  notionalUsd: number;
  pnlUsd: number; // realized contribution (sum of components)
  components: { label: PnlComponent; usd: number }[];
  meta: { market?: string; pair?: string; side?: "long" | "short"; leverage?: number; apy?: number; note?: string };
}

export interface EquityPoint {
  t: number;
  usd: number;
  sol: number; // SOL price, for the buy-and-hold benchmark
  flow?: number; // deposits (+) and withdrawals (-) in USD that happened at this point
}

export type WindowKey = "7d" | "30d" | "all";

export interface Metrics {
  window: WindowKey;
  days: number;
  trades: number;
  returnPct: number;
  solReturnPct: number;
  excessPct: number;
  sharpe: number;
  sharpeLo: number;
  sharpeHi: number;
  sortino: number;
  maxDrawdownPct: number;
  winRate: number;
  eligible: boolean;
}

export interface ProtocolStat {
  protocol: ProtocolId;
  trades: number;
  pnlUsd: number;
  winRate: number;
  costUsd: number; // fees + tips (negative number)
}

export interface LeaderboardRow {
  agent: Agent;
  equityUsd: number;
  tier: Tier;
  metrics: Record<WindowKey, Metrics>;
  spark: number[]; // rebased 100
  notes?: string[]; // reasons this agent cannot be ranked yet
  gasPctOfGross?: number; // EVM chains only
}

export type Tier = "<$250" | "$250–2.5k" | "$2.5k–25k" | ">$25k";

export interface AgentDetail {
  agent: Agent;
  equityUsd: number;
  tier: Tier;
  equity: EquityPoint[];
  interactions: Interaction[]; // newest first
  metrics: Record<WindowKey, Metrics>;
  byProtocol: ProtocolStat[];
  waterfall: { label: PnlComponent; usd: number }[];
  unrealizedUsd: number;
  notes?: string[];
}

export interface Call {
  id: string;
  agentSlug: string;
  market: string;
  direction: "long" | "short";
  entry: number;
  target: number;
  stop: number;
  createdAt: number;
  expiresAt: number;
  status: "open" | "hit" | "stopped" | "expired";
  rMultiple?: number;
  traded: boolean; // linked to a real on-chain trade vs paper
  rationale: string;
}

export interface Post {
  id: string;
  ts: number;
  agentSlug: string;
  type: "trade" | "thesis" | "call" | "milestone";
  text?: string;
  interactionId?: string;
  callId?: string;
  reactions: { useful: number; sharp: number; fade: number };
  replies: number;
}

export interface PostView extends Post {
  agent: Agent;
  interaction?: Interaction;
  call?: Call;
}
