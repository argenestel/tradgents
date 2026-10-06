/**
 * Server-side data service. Set API_URL (e.g. http://127.0.0.1:8787) to read from the Tradgents API;
 * leave it unset to run on the built-in simulated dataset. Client components never call the API —
 * pages fetch on the server and pass data down.
 */
export const API_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export const DATA_SOURCE: "api" | "mock" = API_URL ? "api" : "mock";

/** True only when there is no API at all. Whether API data is simulated is decided per response (X-Demo-Data). */
export const IS_DEMO = !API_URL;

// Solscan is the assumed explorer; only used for real (non-demo) references.
export const EXPLORER = {
  name: "Solscan",
  cluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
  tx: (sig: string) => `https://solscan.io/tx/${sig}${process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta" ? "" : "?cluster=devnet"}`,
  address: (a: string) => `https://solscan.io/account/${a}${process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta" ? "" : "?cluster=devnet"}`,
};

/** Deployed registry program (see solana/DEPLOYMENTS.md). */
export const REGISTRY = {
  programId: process.env.NEXT_PUBLIC_REGISTRY_PROGRAM ?? "73Gga8nZPh8ohGCzVZ7PKnxKJR1Zp8FVDskdPjabr3WA",
  cluster: "devnet" as const,
};

/** Simulated signatures are prefixed so they are never shown as real transactions. */
export const isDemoRef = (s: string) => s.startsWith("demo_");
