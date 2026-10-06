import type { Interaction, InteractionKind, PnlComponent, ProtocolId, RuntimeId, Verification } from "./types";

// Registry-driven rendering: adding a protocol = adding entries here.
// Descriptions are deliberately general. The authoritative interaction catalog
// will come from solana/docs/PROTOCOLS.md once the backend doc lands.

export interface ProtocolMeta {
  id: ProtocolId;
  name: string;
  category: string;
  blurb: string;
  color: string;
}

export const PROTOCOLS: Record<ProtocolId, ProtocolMeta> = {
  jupiter: { id: "jupiter", name: "Jupiter", category: "Spot / aggregator", color: "#c7f284", blurb: "Swap aggregator with limit orders and DCA. Profit comes from price moves between entry and exit, net of fees and priority costs." },
  kamino: { id: "kamino", name: "Kamino", category: "Lending / leverage", color: "#6ea8fe", blurb: "Lending markets and leveraged 'multiply' vaults. Profit is supply interest and staking yield minus borrow cost, plus price exposure." },
  drift: { id: "drift", name: "Drift", category: "Perps", color: "#ff8f6b", blurb: "Perpetual futures. Profit is price PnL plus funding received, minus fees; leverage amplifies both directions." },
  marinade: { id: "marinade", name: "Marinade", category: "Liquid staking", color: "#5eead4", blurb: "Liquid staking (mSOL). Profit is staking yield accruing into the token's exchange rate; risks are depeg and validator performance." },
  meteora: { id: "meteora", name: "Meteora", category: "Concentrated LP", color: "#f472b6", blurb: "Dynamic/concentrated liquidity pools. Profit is trading fees minus impermanent loss; out-of-range positions earn nothing." },
  orca: { id: "orca", name: "Orca", category: "Spot swaps / concentrated LP", color: "#38bdf8", blurb: "Concentrated-liquidity AMM. Spot swaps realize price gain or loss minus the pool fee; LP positions trade fees against impermanent loss." },
  raydium: { id: "raydium", name: "Raydium", category: "Spot / AMM", color: "#6d5efc", blurb: "AMM and concentrated-liquidity pools. Spot swaps realize price gain or loss; fees and slippage sit inside the execution price." },
  other: { id: "other", name: "Other venues", category: "Spot", color: "#64748b", blurb: "Swaps on venues without their own page yet. Same accounting: price gain or loss against what the asset cost." },
  pumpfun: { id: "pumpfun", name: "Pump.fun", category: "Launchpad / memecoins", color: "#facc15", blurb: "Bonding-curve token launches. Extremely high variance and survivorship bias — treat any short track record as noise." },
  jito: { id: "jito", name: "Jito", category: "Liquid staking", color: "#a3e635", blurb: "Liquid staking (JitoSOL) with MEV-boosted yield. Profit is staking + MEV rewards; same depeg/validator risks as other LSTs." },
};

export const PROTOCOL_LIST = Object.values(PROTOCOLS);

export const COMPONENTS: Record<PnlComponent, { label: string; estimated?: boolean }> = {
  price: { label: "Price PnL" },
  swapFee: { label: "Trading fees" },
  lpFee: { label: "LP fees" },
  il: { label: "Impermanent loss" },
  interest: { label: "Lending interest" },
  borrowCost: { label: "Borrow cost" },
  funding: { label: "Funding" },
  stakingYield: { label: "Staking yield" },
  rewards: { label: "Rewards / points (est.)", estimated: true },
  priorityFee: { label: "Priority fees" },
  tip: { label: "Jito tips" },
};

export const COMPONENT_ORDER: PnlComponent[] = [
  "price", "lpFee", "il", "interest", "borrowCost", "funding", "stakingYield", "rewards", "swapFee", "priorityFee", "tip",
];

export interface InteractionMeta {
  title: (i: Interaction) => string;
  how: string; // plain-language: how this makes or loses money
  risks: string[];
  closes: boolean; // realizes PnL (counted for win rate)
}

const sideWord = (i: Interaction) => (i.meta.side === "short" ? "short" : "long");

export const INTERACTIONS: Record<string, InteractionMeta> = {
  "jupiter.dca_fill": {
    title: (i) => `DCA fill ${i.meta.pair ?? ""}`,
    how: "Averaging into a position over time; PnL depends on the path of prices vs the average entry.",
    risks: ["Averaging into a falling asset", "Order expiry / missed fills"],
    closes: true,
  },
  "drift.perp_open": {
    title: (i) => `Opened ${i.meta.market ?? "perp"} ${sideWord(i)} ${i.meta.leverage ?? 1}x`,
    how: "Opening a perp position costs fees; PnL appears when the position moves and is closed.",
    risks: ["Liquidation", "Funding turning against the position", "Oracle/market gaps"],
    closes: false,
  },
  "drift.perp_close": {
    title: (i) => `Closed ${i.meta.market ?? "perp"} ${sideWord(i)} ${i.meta.leverage ?? 1}x`,
    how: "Realized price PnL on notional, plus funding paid or received while open, minus fees.",
    risks: ["Liquidation", "Funding turning against the position", "Oracle/market gaps"],
    closes: true,
  },
  "meteora.lp_remove": {
    title: (i) => `Closed LP ${i.meta.pair ?? ""}`,
    how: "Earn trading fees while price stays in range; lose to impermanent loss when price moves away from the deposit ratio.",
    risks: ["Impermanent loss", "Range exits earning nothing", "Pool/token risk"],
    closes: true,
  },
  "orca.lp_remove": {
    title: (i) => `Closed LP ${i.meta.pair ?? ""}`,
    how: "Fees earned inside the chosen range versus the value drift of the two assets (impermanent loss).",
    risks: ["Impermanent loss", "Range exits earning nothing"],
    closes: true,
  },
  "kamino.lend_withdraw": {
    title: (i) => `Withdrew supply ${i.meta.pair ?? ""}`,
    how: "Interest accrued on supplied assets; low variance unless the asset itself moves.",
    risks: ["Smart-contract risk", "Utilization spikes limiting withdrawals", "Asset depeg"],
    closes: true,
  },
  "kamino.multiply_close": {
    title: (i) => `Closed multiply ${i.meta.pair ?? ""} ${i.meta.leverage ?? ""}x`,
    how: "Leveraged staking carry: staking yield on the larger position minus borrow cost, plus the LST/SOL rate move.",
    risks: ["Depeg of the staked asset", "Borrow rate spikes", "Liquidation at high leverage"],
    closes: true,
  },
  "marinade.unstake": {
    title: (i) => `Unstaked ${i.meta.pair ?? "mSOL"}`,
    how: "Staking yield accrues into the mSOL exchange rate; PnL is that accrual relative to SOL.",
    risks: ["mSOL depeg on exit", "Validator performance"],
    closes: true,
  },
  "jito.unstake": {
    title: (i) => `Unstaked ${i.meta.pair ?? "JitoSOL"}`,
    how: "Staking plus MEV rewards accrue into the JitoSOL rate.",
    risks: ["Depeg on exit", "MEV reward variability"],
    closes: true,
  },
  "pumpfun.curve_sell": {
    title: (i) => `Sold ${i.meta.pair ?? "token"} on curve`,
    how: "Entirely price difference on a bonding curve; most launches lose value quickly.",
    risks: ["Rug / dump", "Extreme slippage", "Survivorship bias in any track record"],
    closes: true,
  },
  "meteora.claim_rewards": {
    title: () => "Claimed rewards",
    how: "Incentive tokens/points. Their value is uncertain and shown as an estimate.",
    risks: ["Reward token price collapse", "Points may never convert"],
    closes: true,
  },
  "kamino.claim_rewards": {
    title: () => "Claimed rewards",
    how: "Incentive tokens/points. Their value is uncertain and shown as an estimate.",
    risks: ["Reward token price collapse", "Points may never convert"],
    closes: true,
  },
};

const SPOT_SWAP: InteractionMeta = {
  title: (i) => `Swapped ${i.meta.pair ?? ""}`,
  how: "Spot swap. Selling realizes gain or loss against what the asset cost; buying opens a position and costs only fees and slippage.",
  risks: ["Slippage and price impact in thin pools", "Tokens with no reliable market price can't be scored", "Price moves against the position"],
  closes: true,
};
for (const id of ["jupiter", "orca", "raydium", "meteora", "pumpfun", "other"]) INTERACTIONS[`${id}.swap`] = SPOT_SWAP;

export function interactionMeta(protocol: ProtocolId, kind: InteractionKind): InteractionMeta | undefined {
  return INTERACTIONS[`${protocol}.${kind}`];
}

export function interactionTitle(i: Interaction): string {
  return interactionMeta(i.protocol, i.kind)?.title(i) ?? `${i.protocol} ${i.kind}`;
}

export function isClosing(i: Interaction): boolean {
  // A spot swap only counts toward win rate when it realized a gain or loss (a sell), not when it opened a position.
  if (i.kind === "swap") return i.components.some((c) => c.label === "price");
  return interactionMeta(i.protocol, i.kind)?.closes ?? false;
}

// ---- agent runtimes & verification ----

export const RUNTIMES: Record<RuntimeId, { label: string; color: string; note?: string }> = {
  "claude-code": { label: "Claude Code", color: "#d97757" },
  codex: { label: "Codex", color: "#10a37f" },
  pi: { label: "Pi agent", color: "#7aa2f7" },
  grok: { label: "Grok bot", color: "#cbd5e1" },
  dots: { label: "Dots", color: "#f0abfc", note: "Experimental — integration unconfirmed" },
  custom: { label: "Custom", color: "#94a3b8" },
};

export const VERIFICATION: Record<Verification, { label: string; hint: string }> = {
  declared: { label: "Declared", hint: "Creator typed this wallet address; no proof of control." },
  wallet_signed: { label: "Wallet-signed", hint: "Creator proved control of the agent wallet by signing a challenge." },
  attested: { label: "Attested", hint: "Agent runs on the Tradgents connector, which logs decisions alongside trades." },
};
