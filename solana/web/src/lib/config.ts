/**
 * Everything on this site is real Solana devnet data served by the Tradgents API. There is no simulated
 * dataset. Set API_URL (e.g. http://127.0.0.1:8787); without it, pages show a "data service not configured" error.
 */
export const API_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") as "devnet" | "mainnet-beta";
const q = CLUSTER === "mainnet-beta" ? "" : `?cluster=${CLUSTER}`;

export const EXPLORER = {
  name: "Solscan",
  tx: (sig: string) => `https://solscan.io/tx/${sig}${q}`,
  address: (a: string) => `https://solscan.io/account/${a}${q}`,
};

/** Registry program (see solana/DEPLOYMENTS.md). */
export const REGISTRY = {
  programId: process.env.NEXT_PUBLIC_REGISTRY_PROGRAM ?? "73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA",
  cluster: CLUSTER,
};
