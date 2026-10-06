import { monad } from "viem/chains";

/**
 * Central, env-driven config. Everything public is NEXT_PUBLIC_*; there are no
 * secrets in the frontend.
 *
 * Chain facts follow monad/docs/BACKEND.md §1.1 (official docs): chain id 143,
 * ~300 ms blocks, ~600 ms finality. viem's built-in chain definition reports a
 * stale 400 ms blockTime, so we only use it for id/RPC/explorer metadata.
 */
export const CHAIN = monad;

export const RPC_URL = process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? CHAIN.rpcUrls.default.http[0];

/** When unset the app runs on the in-memory demo dataset. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
export const IS_DEMO = !API_URL;

export const EXPLORER = {
  name: CHAIN.blockExplorers.default.name,
  url: CHAIN.blockExplorers.default.url,
  tx: (hash: string) => `${CHAIN.blockExplorers.default.url}/tx/${hash}`,
  address: (a: string) => `${CHAIN.blockExplorers.default.url}/address/${a}`,
};

export const BLOCK_TIME_MS = 300;
export const FINALITY_MS = 600;

/**
 * AgentRegistry is not deployed yet. Signatures made against this address are a
 * dry run and are not submitted anywhere. Set NEXT_PUBLIC_AGENT_REGISTRY once deployed.
 */
export const AGENT_REGISTRY = (process.env.NEXT_PUBLIC_AGENT_REGISTRY ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
export const REGISTRY_DEPLOYED = AGENT_REGISTRY !== "0x0000000000000000000000000000000000000000";
