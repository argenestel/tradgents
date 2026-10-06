// Frontend data contracts for the Monad app. These are the frontend's
// *requirements* for the backend (see monad/docs/FRONTEND.md and BACKEND.md §10).

export type RuntimeId = "claude-code" | "codex" | "pi" | "grok" | "dots" | "custom";
export type Verification = "declared" | "wallet_signed" | "attested";
export type ProtocolId =
  | "kuru"
  | "uniswap"
  | "morpho"
  | "curvance"
  | "magma"
  | "upshift"
  | "perpl"
  | "nadfun";

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
  | "gas"
  | "mevLeak";

export type InteractionKind =
  | "swap"
  | "limit_fill"
  | "lp_remove"
  | "lend_withdraw"
  | "loop_close"
  | "unstake"
  | "vault_redeem"
  | "perp_open"
  | "perp_close"
  | "curve_sell"
  | "claim_rewards";

export type AccountType = "eoa" | "eip7702" | "erc4337";

export interface Approval {
  token: string;
  spender: string;
  spenderLabel?: string; // undefined => unlabeled/unknown contract
  amountUsd: number | "unlimited";
  risk: "low" | "medium" | "high";
}

export interface SessionPolicy {
  status: "active" | "expiring" | "none";
  allowedProtocols: ProtocolId[];
  perTradeCapUsd: number;
  dailyCapUsd: number;
  usedTodayUsd: number;
  expiresAt: number;
  changes: { ts: number; text: string }[];
}

export interface Agent {
  slug: string;
  name: string;
  bio: string;
  runtime: RuntimeId;
  verification: Verification;
  strategyLabel: string;
  wallet: string; // 0x… agent address
  owner: string; // 0x… creator
  accountType: AccountType;
  erc8004Id?: number; // on-chain identity token id, if registered
  protocols: ProtocolId[];
  startedAt: number;
  startCapitalUsd: number;
  status: "live" | "stale";
  bondMon: number;
  policy: SessionPolicy;
  approvals: Approval[];
  fingerprint: { avgHoldHours: number; avgLeverage: number; tradesPerDay: number };
}

export interface Leg {
  symbol: string;
  delta: number;
  usd: number;
}

export interface Interaction {
  id: string;
  agentSlug: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  ts: number;
  protocol: ProtocolId;
  kind: InteractionKind;
  legs: Leg[];
  notionalUsd: number;
  pnlUsd: number;
  components: { label: PnlComponent; usd: number }[];
  execution: { slippageBps: number; private: boolean; mevBps: number };
  meta: { market?: string; pair?: string; side?: "long" | "short"; leverage?: number; ltv?: number };
}

export interface EquityPoint {
  t: number;
  usd: number;
  sol: number; // benchmark price series (MON buy-and-hold); name kept for shared chart code
}

export type WindowKey = "7d" | "30d" | "all";

export interface Metrics {
  window: WindowKey;
  days: number;
  trades: number;
  returnPct: number;
  solReturnPct: number; // benchmark return (MON)
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
  costUsd: number; // gas + MEV leakage (negative)
}

export type Tier = "<$250" | "$250–2.5k" | "$2.5k–25k" | ">$25k";

export interface ExecutionStats {
  gasPctOfGross: number;
  avgSlippageBps: number;
  privateFlowPct: number;
  avgMevBps: number;
}

export interface LeaderboardRow {
  agent: Agent;
  equityUsd: number;
  tier: Tier;
  metrics: Record<WindowKey, Metrics>;
  spark: number[];
  gasPctOfGross?: number;
}

export interface AgentDetail {
  agent: Agent;
  equityUsd: number;
  tier: Tier;
  equity: EquityPoint[];
  interactions: Interaction[];
  metrics: Record<WindowKey, Metrics>;
  byProtocol: ProtocolStat[];
  waterfall: { label: PnlComponent; usd: number }[];
  unrealizedUsd: number;
  execution: ExecutionStats;
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
  traded: boolean;
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
