import {
  type Address,
  type Hex,
  type PublicClient,
  decodeEventLog,
  parseAbi,
} from "viem";
import type { Db } from "./db.ts";

export const REGISTRY_EVENTS = parseAbi([
  "event AgentRegistered(address indexed agentWallet, address indexed ownerWallet, bytes32 metadataHash, uint256 bondWei, uint256 nonce)",
  "event BondWithdrawn(address indexed agentWallet, address indexed ownerWallet, uint256 amount)",
  "event AgentPaused(address indexed agentWallet, address indexed guardian, bytes32 reason)",
  "event AgentSlashed(address indexed agentWallet, address indexed treasury, uint256 amount, bytes32 reason)",
]);

export class Indexer {
  constructor(
    private db: Db,
    private client: PublicClient,
    private registry: Address,
    private chainId: number,
  ) {}

  /** Backfill from last stored head (or 0) through the current block. Idempotent. */
  async backfill(now = Date.now()): Promise<{ from: number; to: number; applied: number }> {
    const latest = Number(await this.client.getBlockNumber());
    const head = this.db.indexerHead();
    const from = head === 0 ? 0 : head;
    return this.indexRange(BigInt(from), BigInt(latest), now);
  }

  async indexRange(fromBlock: bigint, toBlock: bigint, now = Date.now()): Promise<{ from: number; to: number; applied: number }> {
    if (toBlock < fromBlock) return { from: Number(fromBlock), to: Number(toBlock), applied: 0 };

    const logs = await this.client.getLogs({
      address: this.registry,
      fromBlock,
      toBlock,
    });

    let applied = 0;
    for (const log of logs) {
      const inserted = this.db.insertRawLog({
        chainId: this.chainId,
        txHash: log.transactionHash!,
        logIndex: log.logIndex ?? 0,
        blockNumber: Number(log.blockNumber ?? 0),
        blockHash: log.blockHash ?? "0x",
        address: log.address,
        topic0: (log.topics[0] ?? "0x") as string,
        topics: JSON.stringify(log.topics),
        data: log.data,
      });
      if (!inserted) continue;

      let decoded;
      try {
        decoded = decodeEventLog({
          abi: REGISTRY_EVENTS,
          data: log.data,
          topics: log.topics,
        });
      } catch {
        continue;
      }

      const args = decoded.args as Record<string, unknown>;
      switch (decoded.eventName) {
        case "AgentRegistered":
          this.db.applyRegistered({
            wallet: String(args.agentWallet),
            owner: String(args.ownerWallet),
            metadataHash: String(args.metadataHash),
            bondWei: args.bondWei as bigint,
            now,
          });
          applied++;
          break;
        case "BondWithdrawn":
          this.db.applyBondWithdrawn(String(args.agentWallet));
          applied++;
          break;
        case "AgentPaused":
          this.db.applyPaused(String(args.agentWallet));
          applied++;
          break;
        case "AgentSlashed":
          this.db.applySlashed(String(args.agentWallet));
          applied++;
          break;
        default:
          break;
      }
    }

    this.db.setIndexerHead(Number(toBlock));
    return { from: Number(fromBlock), to: Number(toBlock), applied };
  }

  start(pollMs: number): NodeJS.Timeout {
    const tick = () => {
      this.backfill().catch((err) => console.error("indexer", err));
    };
    tick();
    return setInterval(tick, pollMs);
  }
}

export type { Hex };
