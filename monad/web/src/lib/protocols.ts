import type { Interaction, InteractionKind, PnlComponent, ProtocolId, RuntimeId, Verification } from "./types";

// Registry-driven rendering: adding a protocol = adding entries here.
// Protocol names follow monad/docs/PROTOCOLS.md. Descriptions are deliberately
// general; contract addresses/ABIs are NOT hard-coded here (several are still
// "verify" in the backend catalog).

export interface ProtocolMeta {
  id: ProtocolId;
  name: string;
  category: string;
  blurb: string;
  color: string;
  confidence: "high" | "med" | "low"; // how settled the indexing surface is, per PROTOCOLS.md
}

export const PROTOCOLS: Record<ProtocolId, ProtocolMeta> = {
  kuru: { id: "kuru", name: "Kuru", category: "Orderbook / spot", color: "#7dd3fc", confidence: "high", blurb: "Onchain orderbook DEX and aggregator. Profit comes from price moves and spread capture (maker fills), net of fees and gas — gas is charged on the gas limit on Monad, so failed or oversized transactions still cost." },
  uniswap: { id: "uniswap", name: "Uniswap", category: "AMM / concentrated LP", color: "#f472b6", confidence: "high", blurb: "AMM swaps and concentrated liquidity. LP profit is fees minus impermanent loss; out-of-range positions earn nothing." },
  morpho: { id: "morpho", name: "Morpho", category: "Lending / leverage loops", color: "#60a5fa", confidence: "high", blurb: "Isolated lending markets. Profit is supply interest, or the carry between collateral yield and borrow cost on looped positions; the risk is liquidation." },
  curvance: { id: "curvance", name: "Curvance", category: "Lending", color: "#a78bfa", confidence: "med", blurb: "Lending markets with isolated collateral. Same interest-versus-borrow-cost and liquidation dynamics as other money markets; event surface still being confirmed." },
  magma: { id: "magma", name: "Magma", category: "Liquid staking", color: "#fb923c", confidence: "high", blurb: "Liquid staking (gMON). Profit is staking yield accruing into the token's exchange rate; risks are depeg on exit and validator performance." },
  upshift: { id: "upshift", name: "Upshift", category: "Yield vaults", color: "#34d399", confidence: "high", blurb: "Yield vaults. Profit is vault share-price growth net of fees; strategy and redemption-delay risk sit with the vault operator." },
  perpl: { id: "perpl", name: "Perpl", category: "Perps", color: "#f87171", confidence: "med", blurb: "Perpetual futures. Profit is price PnL plus funding, minus fees; leverage amplifies both directions. Fill-level data depends on an ABI we are still confirming." },
  nadfun: { id: "nadfun", name: "nad.fun", category: "Launchpad / memecoins", color: "#facc15", confidence: "high", blurb: "Bonding-curve token launches. Extremely high variance and survivorship bias — any short track record is mostly noise." },
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
  gas: { label: "Gas (limit × price)" },
  mevLeak: { label: "MEV leakage (est.)", estimated: true },
};

export const COMPONENT_ORDER: PnlComponent[] = [
  "price", "lpFee", "il", "interest", "borrowCost", "funding", "stakingYield", "rewards", "swapFee", "gas", "mevLeak",
];

export interface InteractionMeta {
  title: (i: Interaction) => string;
  how: string;
  risks: string[];
  closes: boolean;
  copyable?: boolean; // supported by the non-custodial copy flow in v1
}

const sideWord = (i: Interaction) => (i.meta.side === "short" ? "short" : "long");

export const INTERACTIONS: Record<string, InteractionMeta> = {
  "kuru.swap": {
    title: (i) => `Swapped ${i.meta.pair ?? ""}`,
    how: "Gain or loss from the price difference between buying and selling, minus fees and gas. Aggregated routes can split across venues.",
    risks: ["Slippage on thin books", "Sandwich-style MEV on public orderflow", "Unverified tokens"],
    closes: true,
    copyable: true,
  },
  "kuru.limit_fill": {
    title: (i) => `Limit order filled ${i.meta.pair ?? ""}`,
    how: "A resting order fills at the agent's price. Market makers earn the spread (and sometimes a rebate) but carry inventory risk.",
    risks: ["Adverse selection (filled before price moves against you)", "Inventory risk", "Stale quotes"],
    closes: true,
  },
  "uniswap.swap": {
    title: (i) => `Swapped ${i.meta.pair ?? ""}`,
    how: "Price difference between entry and exit minus pool fees and gas.",
    risks: ["Price impact", "Sandwich-style MEV", "Fee-on-transfer / scam tokens"],
    closes: true,
    copyable: true,
  },
  "uniswap.lp_remove": {
    title: (i) => `Closed LP ${i.meta.pair ?? ""}`,
    how: "Fees earned while price is in range, minus impermanent loss from the price moving away from the deposit ratio.",
    risks: ["Impermanent loss", "Range exits earning nothing", "Pool/token risk"],
    closes: true,
  },
  "morpho.lend_withdraw": {
    title: (i) => `Withdrew supply ${i.meta.pair ?? ""}`,
    how: "Interest accrued on supplied assets. Low variance unless the asset itself moves.",
    risks: ["Smart-contract risk", "Utilization spikes limiting withdrawals", "Collateral/oracle risk in the market"],
    closes: true,
  },
  "morpho.loop_close": {
    title: (i) => `Closed loop ${i.meta.pair ?? ""} ${i.meta.leverage ?? ""}x`,
    how: "Leveraged carry: collateral yield on the larger position minus borrow cost, plus the rate move between collateral and debt asset.",
    risks: ["Liquidation if LTV rises", "Borrow rate spikes", "Depeg of the staked collateral"],
    closes: true,
  },
  "curvance.lend_withdraw": {
    title: (i) => `Withdrew supply ${i.meta.pair ?? ""}`,
    how: "Interest accrued on supplied assets; isolated-market risk applies.",
    risks: ["Smart-contract risk", "Isolated-market bad debt", "Utilization spikes"],
    closes: true,
  },
  "magma.unstake": {
    title: (i) => `Unstaked ${i.meta.pair ?? "gMON"}`,
    how: "Staking yield accrues into the gMON exchange rate; PnL is that accrual relative to MON.",
    risks: ["Depeg on exit", "Unbonding delay", "Validator performance"],
    closes: true,
  },
  "upshift.vault_redeem": {
    title: (i) => `Redeemed vault ${i.meta.pair ?? ""}`,
    how: "Vault share price growth between deposit and redemption, net of vault fees.",
    risks: ["Strategy risk", "Redemption delays", "Operator/key risk"],
    closes: true,
  },
  "perpl.perp_open": {
    title: (i) => `Opened ${i.meta.market ?? "perp"} ${sideWord(i)} ${i.meta.leverage ?? 1}x`,
    how: "Opening a perp costs fees and gas; PnL appears as the position moves and is closed.",
    risks: ["Liquidation", "Funding turning against the position", "Oracle/market gaps"],
    closes: false,
  },
  "perpl.perp_close": {
    title: (i) => `Closed ${i.meta.market ?? "perp"} ${sideWord(i)} ${i.meta.leverage ?? 1}x`,
    how: "Realized price PnL on notional, plus funding while open, minus fees and gas.",
    risks: ["Liquidation", "Funding turning against the position", "Oracle/market gaps"],
    closes: true,
  },
  "nadfun.curve_sell": {
    title: (i) => `Sold ${i.meta.pair ?? "token"} on curve`,
    how: "Entirely price difference on a bonding curve; most launches lose value quickly.",
    risks: ["Rug / dump", "Extreme slippage", "Survivorship bias in any track record"],
    closes: true,
  },
  "morpho.claim_rewards": {
    title: () => "Claimed rewards",
    how: "Incentive tokens/points. Their value is uncertain and shown as an estimate.",
    risks: ["Reward token price collapse", "Points may never convert"],
    closes: true,
  },
};

export function interactionMeta(protocol: ProtocolId, kind: InteractionKind): InteractionMeta | undefined {
  return INTERACTIONS[`${protocol}.${kind}`];
}

export function interactionTitle(i: Interaction): string {
  return interactionMeta(i.protocol, i.kind)?.title(i) ?? `${i.protocol} ${i.kind}`;
}

export function isClosing(i: Interaction): boolean {
  return interactionMeta(i.protocol, i.kind)?.closes ?? false;
}

// ---- agent runtimes, verification, accounts ----

export const RUNTIMES: Record<RuntimeId, { label: string; color: string; note?: string }> = {
  "claude-code": { label: "Claude Code", color: "#d97757" },
  codex: { label: "Codex", color: "#10a37f" },
  pi: { label: "Pi agent", color: "#7aa2f7" },
  grok: { label: "Grok bot", color: "#cbd5e1" },
  dots: { label: "Dots", color: "#f0abfc", note: "Experimental — integration unconfirmed" },
  custom: { label: "Custom", color: "#94a3b8" },
};

export const VERIFICATION: Record<Verification, { label: string; hint: string }> = {
  declared: { label: "Declared", hint: "Creator typed this address; no proof of control." },
  wallet_signed: { label: "Wallet-signed", hint: "Creator proved control of the agent address with an EIP-712 signature (ERC-1271 for smart accounts)." },
  attested: { label: "Attested", hint: "Agent runs on the Tradgents connector with a scoped session key, logging decisions alongside trades." },
};

export const ACCOUNT_TYPES = {
  eoa: { label: "EOA", hint: "Plain externally-owned account. The agent holds a full-power key — least safe for autonomous trading." },
  eip7702: { label: "EIP-7702", hint: "EOA delegated to smart-account code. Note: a delegated EOA cannot drop below 10 MON on Monad." },
  erc4337: { label: "Smart account", hint: "ERC-4337 smart account. Supports scoped session keys and spend limits." },
} as const;

/** Human labels for the contract a copy-trade would approve/spend through. Addresses come from the backend catalog, never hard-coded here. */
export const SPENDER_LABEL: Record<ProtocolId, string> = {
  kuru: "Kuru router",
  uniswap: "Uniswap Universal Router",
  morpho: "Morpho",
  curvance: "Curvance market",
  magma: "Magma staking",
  upshift: "Upshift vault",
  perpl: "Perpl exchange",
  nadfun: "nad.fun curve",
};
