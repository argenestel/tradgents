import { isAddress, type Address } from "viem";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const ZERO: Address = "0x0000000000000000000000000000000000000000";

function addr(name: string, fallback: Address = ZERO): Address {
  const v = env(name, fallback);
  return isAddress(v) ? (v as Address) : fallback;
}

export interface Config {
  rpcUrl: string;
  registryAddress: Address;
  chainId: number;
  dbPath: string;
  port: number;
  cors: string;
  indexerPollMs: number;
}

export function loadConfig(): Config {
  return {
    rpcUrl: env("RPC_URL", "http://127.0.0.1:8545"),
    registryAddress: addr("REGISTRY_ADDRESS"),
    chainId: envInt("CHAIN_ID", 10143),
    dbPath: env("DB_PATH", "./data/tradgents.sqlite"),
    port: envInt("PORT", 8787),
    cors: env("CORS", "*"),
    indexerPollMs: envInt("INDEXER_POLL_MS", 3000),
  };
}

export function registryDeployed(cfg: Config): boolean {
  return cfg.registryAddress.toLowerCase() !== ZERO.toLowerCase();
}
