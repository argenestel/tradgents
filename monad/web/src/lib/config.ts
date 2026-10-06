import { monad } from "viem/chains";

/**
 * Everything on this site is real Monad data served by the Tradgents API. There is no simulated dataset.
 * API_URL is server-side (e.g. http://127.0.0.1:8788); without it, pages show a "data service not configured" error.
 * Chain facts follow monad/docs/BACKEND.md: chain id 143, ~300 ms blocks, ~600 ms finality.
 */
export const API_URL = (process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
export const CHAIN = monad;
export const EXPLORER = {
  name: CHAIN.blockExplorers.default.name,
  url: CHAIN.blockExplorers.default.url,
  tx: (hash: string) => `${CHAIN.blockExplorers.default.url}/tx/${hash}`,
  address: (a: string) => `${CHAIN.blockExplorers.default.url}/address/${a}`,
};
/** Registry contract, set once deployed (see monad/contracts). */
export const REGISTRY = { programId: process.env.NEXT_PUBLIC_AGENT_REGISTRY ?? "", cluster: "mainnet" as const };
