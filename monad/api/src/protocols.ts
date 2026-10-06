import type { Interaction, InteractionKind, PnlComponent, ProtocolId } from "./types.ts";

export const PROTOCOL_IDS = [
  "kuru",
  "uniswap",
  "morpho",
  "curvance",
  "magma",
  "upshift",
  "perpl",
  "nadfun",
] as const satisfies readonly ProtocolId[];

export const PROTOCOLS: Record<ProtocolId, { id: ProtocolId; name: string; category: string }> = {
  kuru: { id: "kuru", name: "Kuru", category: "Orderbook / spot" },
  uniswap: { id: "uniswap", name: "Uniswap", category: "AMM / concentrated LP" },
  morpho: { id: "morpho", name: "Morpho", category: "Lending / leverage loops" },
  curvance: { id: "curvance", name: "Curvance", category: "Lending" },
  magma: { id: "magma", name: "Magma", category: "Liquid staking" },
  upshift: { id: "upshift", name: "Upshift", category: "Yield vaults" },
  perpl: { id: "perpl", name: "Perpl", category: "Perps" },
  nadfun: { id: "nadfun", name: "nad.fun", category: "Launchpad / memecoins" },
};

export const COMPONENT_ORDER: PnlComponent[] = [
  "price",
  "lpFee",
  "il",
  "interest",
  "borrowCost",
  "funding",
  "stakingYield",
  "rewards",
  "swapFee",
  "gas",
  "mevLeak",
];

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

const CLOSING: Record<string, boolean> = {
  "kuru.swap": true,
  "kuru.limit_fill": true,
  "uniswap.swap": true,
  "uniswap.lp_remove": true,
  "morpho.lend_withdraw": true,
  "morpho.loop_close": true,
  "morpho.claim_rewards": true,
  "curvance.lend_withdraw": true,
  "magma.unstake": true,
  "upshift.vault_redeem": true,
  "perpl.perp_open": false,
  "perpl.perp_close": true,
  "nadfun.curve_sell": true,
};

export function isClosing(i: Interaction): boolean {
  return CLOSING[`${i.protocol}.${i.kind}`] ?? false;
}

export function isProtocolId(s: string): s is ProtocolId {
  return (PROTOCOL_IDS as readonly string[]).includes(s);
}

export type { InteractionKind };
