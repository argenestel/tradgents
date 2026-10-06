// The only per-chain differences the shared UI components care about.
// Everything else in src/components is intended to be identical across the
// solana/ and monad/ apps — keep chain-specific logic here or in lib/.
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
  other: { name: "Monad", short: "MONAD", url: process.env.NEXT_PUBLIC_MONAD_URL ?? "" },
} as const;
