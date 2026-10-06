import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeDeployData,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { REGISTER_TYPES, eip712Domain } from "../src/auth.ts";
import { Db } from "../src/db.ts";
import { Indexer, REGISTRY_EVENTS } from "../src/indexer.ts";
import { createApp } from "../src/app.ts";
import type { Config } from "../src/config.ts";

const ANVIL0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ANVIL1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex;
const PORT = 18545;
const RPC = `http://127.0.0.1:${PORT}`;

const registryArtifact = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../contracts/out/AgentRegistry.sol/AgentRegistry.json"), "utf8"),
) as { abi: unknown[]; bytecode: { object: Hex } };

const mockArtifact = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../contracts/out/MockERC1271.sol/MockERC1271.json"), "utf8"),
) as { abi: unknown[]; bytecode: { object: Hex } };

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRpc(url: string, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await wait(100);
  }
  throw new Error("anvil did not start");
}

describe("indexer against anvil", () => {
  let proc: ChildProcess | undefined;
  const account = privateKeyToAccount(ANVIL0);
  const inner = privateKeyToAccount(ANVIL1);

  beforeAll(async () => {
    proc = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
    await waitForRpc(RPC);
  }, 20_000);

  afterAll(() => {
    proc?.kill("SIGTERM");
  });

  it("indexes AgentRegistered idempotently and verifies ERC-1271", async () => {
    const transport = http(RPC);
    const publicClient = createPublicClient({ chain: foundry, transport });
    const wallet = createWalletClient({ account, chain: foundry, transport });

    const guardian = account.address;
    const treasury = inner.address;
    const deployData = encodeDeployData({
      abi: registryArtifact.abi,
      bytecode: registryArtifact.bytecode.object,
      args: [guardian, treasury, parseEther("0.1"), 7n * 24n * 3600n],
    } as never);
    const tx = await wallet.sendTransaction({ data: deployData });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
    const registry = receipt.contractAddress as Address;
    expect(registry).toBeTruthy();

    const mockData = encodeDeployData({
      abi: mockArtifact.abi,
      bytecode: mockArtifact.bytecode.object,
      args: [inner.address],
    } as never);
    const mockTx = await wallet.sendTransaction({ data: mockData });
    const mockRcpt = await publicClient.waitForTransactionReceipt({ hash: mockTx });
    const smart = mockRcpt.contractAddress as Address;

    const chainId = await publicClient.getChainId();
    const domain = eip712Domain(chainId, registry);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const metadataHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;

    // EOA register on-chain
    const eoaMsg = {
      agentWallet: account.address,
      ownerWallet: account.address,
      metadataHash,
      nonce: 0n,
      deadline,
    };
    const eoaSig = await account.signTypedData({ domain, types: REGISTER_TYPES, primaryType: "Register", message: eoaMsg });
    const registerAbi = parseAbi([
      "function register(address agentWallet, address ownerWallet, bytes32 metadataHash, uint256 nonce, uint256 deadline, bytes signature) payable",
    ]);
    const eoaHash = await wallet.writeContract({
      address: registry,
      abi: registerAbi,
      functionName: "register",
      args: [account.address, account.address, metadataHash, 0n, deadline, eoaSig],
      value: parseEther("0.1"),
    });
    await publicClient.waitForTransactionReceipt({ hash: eoaHash });

    // ERC-1271 register on-chain (inner key signs, wallet is the contract)
    const saMsg = {
      agentWallet: smart,
      ownerWallet: account.address,
      metadataHash,
      nonce: 0n,
      deadline,
    };
    const saSig = await inner.signTypedData({ domain, types: REGISTER_TYPES, primaryType: "Register", message: saMsg });
    const saHash = await wallet.writeContract({
      address: registry,
      abi: registerAbi,
      functionName: "register",
      args: [smart, account.address, metadataHash, 0n, deadline, saSig],
      value: parseEther("0.1"),
    });
    await publicClient.waitForTransactionReceipt({ hash: saHash });

    const db = new Db(":memory:");
    const indexer = new Indexer(db, publicClient, registry, chainId);
    const first = await indexer.backfill();
    expect(first.applied).toBe(2);
    expect(db.agentByWallet(account.address)).toBeTruthy();
    expect(db.agentByWallet(smart)).toBeTruthy();
    expect(db.agentByWallet(account.address)!.verification).toBe("wallet_signed");
    expect(db.agentByWallet(account.address)!.bondMon).toBeCloseTo(0.1, 6);

    const second = await indexer.backfill();
    expect(second.applied).toBe(0);
    expect(db.allAgents().length).toBe(2);

    const logs = await publicClient.getLogs({ address: registry, fromBlock: 0n, events: REGISTRY_EVENTS });
    const registered = logs.filter((l) => {
      try {
        return decodeEventLog({ abi: REGISTRY_EVENTS, data: l.data, topics: l.topics }).eventName === "AgentRegistered";
      } catch {
        return false;
      }
    });
    expect(registered.length).toBe(2);

    // API ERC-1271 verify against the live mock
    const config: Config = {
      rpcUrl: RPC,
      registryAddress: registry,
      chainId,
      dbPath: ":memory:",
      port: 0,
      cors: "*",
      indexerPollMs: 1000,
    };
    const apiDb = new Db(":memory:");
    const app = createApp({ db: apiDb, config, client: publicClient });
    const apiDeadline = BigInt(Math.floor(Date.now() / 1000) + 900);
    const apiMsg = {
      agentWallet: smart,
      ownerWallet: account.address,
      metadataHash,
      nonce: 0n,
      deadline: apiDeadline,
    };
    const apiSig = await inner.signTypedData({
      domain: eip712Domain(chainId, registry),
      types: REGISTER_TYPES,
      primaryType: "Register",
      message: apiMsg,
    });
    const res = await app.request("/v1/agents/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentWallet: smart,
        ownerWallet: account.address,
        metadataHash,
        nonce: "0",
        deadline: apiDeadline.toString(),
        signature: apiSig,
        slug: "smart-bot",
        name: "SmartBot",
        bio: "erc1271 agent",
        runtime: "custom",
        accountType: "erc4337",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { agent: { wallet: string; verification: string }; interactions: unknown[] };
    expect(body.agent.wallet.toLowerCase()).toBe(smart.toLowerCase());
    expect(body.agent.verification).toBe("wallet_signed");
    expect(body.interactions).toEqual([]);
  });
});
