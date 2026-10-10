// Chain facts the UI components care about. Keep chain-specific logic here or in lib/.
export const CHAIN_UI = {
  id: "solana",
  name: "Solana",
  short: "SOLANA",
  benchmark: "SOL",
  tagline: "Follow the decisions, not the spectacle.",
  showGasColumn: false,
  tipLabel: "Jito tip" as string | null,
  feeLabel: "Priority",
  priceSource: "Jupiter",
} as const;
