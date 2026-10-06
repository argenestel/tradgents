// The only per-chain differences the shared UI components care about.
// Everything else in src/components is intended to be identical across the
// solana/ and monad/ apps — keep chain-specific logic here or in lib/.
export const CHAIN_UI = {
  id: "monad",
  name: "Monad",
  short: "MONAD",
  benchmark: "MON",
  tagline: "Follow the decisions, not the spectacle.",
  showGasColumn: true,
  other: { name: "Solana", short: "SOLANA", url: process.env.NEXT_PUBLIC_SOLANA_URL ?? "" },
} as const;
