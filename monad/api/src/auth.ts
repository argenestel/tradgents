import {
  type Address,
  type Hex,
  hashTypedData,
  recoverTypedDataAddress,
  keccak256,
  toBytes,
} from "viem";
import type { PublicClient } from "viem";

export const REGISTER_TYPES = {
  Register: [
    { name: "agentWallet", type: "address" },
    { name: "ownerWallet", type: "address" },
    { name: "metadataHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const POST_TYPES = {
  Post: [
    { name: "agentWallet", type: "address" },
    { name: "contentHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const CALL_TYPES = {
  Call: [
    { name: "agentWallet", type: "address" },
    { name: "contentHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function eip712Domain(chainId: number, verifyingContract: Address) {
  return { name: "Tradgents", version: "1", chainId, verifyingContract } as const;
}

export function contentHash(text: string): Hex {
  return keccak256(toBytes(text));
}

const ERC1271_ABI = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;

const MAGIC = "0x1626ba7e";

export type SigKind = "eip712" | "erc1271";

export async function verifyTyped(
  args: {
    address: Address;
    domain: ReturnType<typeof eip712Domain>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    types: any;
    primaryType: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    message: any;
    signature: Hex;
    client?: PublicClient;
  },
): Promise<SigKind> {
  const { address, domain, types, primaryType, message, signature, client } = args;
  try {
    const recovered = await recoverTypedDataAddress({
      domain,
      types,
      primaryType,
      message,
      signature,
    });
    if (recovered.toLowerCase() === address.toLowerCase()) return "eip712";
  } catch {
    // not a recoverable ECDSA signature — try ERC-1271
  }

  if (!client) throw new Error("signature not from agent wallet");

  const digest = hashTypedData({ domain, types, primaryType, message });
  try {
    const magic = await client.readContract({
      address,
      abi: ERC1271_ABI,
      functionName: "isValidSignature",
      args: [digest, signature],
    });
    if (typeof magic === "string" && magic.toLowerCase() === MAGIC) return "erc1271";
  } catch {
    throw new Error("ERC-1271 signature check failed");
  }
  throw new Error("signature not from agent wallet");
}

const HTML_RE = /<\/?[a-z][\s\S]*>/i;
const CTRL_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

export function assertPlainText(text: string, max = 4000): void {
  if (text.length === 0) throw new Error("empty text");
  if (text.length > max) throw new Error("text too long");
  if (CTRL_RE.test(text)) throw new Error("control characters not allowed");
  if (HTML_RE.test(text)) throw new Error("plain text only");
}
