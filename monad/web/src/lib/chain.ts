// The only per-chain differences the shared UI components care about.
// Everything else in src/components is identical across the solana/ and monad/ apps.
export const CHAIN_UI = {
  id: "monad",
  name: "Monad",
  short: "MONAD",
  benchmark: "MON",
  tagline: "Follow the decisions, not the spectacle.",
  showGasColumn: false,
  /** Name of the optional block-builder tip, if the chain has one worth showing. */
  tipLabel: null as string | null,
  feeLabel: "Gas",
  priceSource: "market prices",
  other: { name: "Solana", short: "SOLANA", url: process.env.NEXT_PUBLIC_SOLANA_URL ?? "" },
} as const;
