import { setNativeMintWrappingStrategy, swapInstructions, WhirlpoolDeployment } from '@orca-so/whirlpools';
import { address, createNoopSigner, createSolanaRpc, devnet, type Instruction } from '@solana/kit';
import type { JupiterApi, PriceApi, Quote } from './jupiter';
import type { JupIx, SwapPlan } from './validate';

/** Orca's SOL/devUSDC pool on devnet, the only market that exists there. */
export const ORCA_DEVNET_POOL = '3KBZiL2g8C7tiJ32hTv5v3KM7aK9htpqTw4cTXz1HvPt';
export const ORCA_PROGRAM = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
export const DEVNET_USDC = 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k';
const WSOL = 'So11111111111111111111111111111111111111112';

// AccountRole: 0 readonly, 1 writable, 2 readonly signer, 3 writable signer
const toJupIx = (ix: Instruction): JupIx => ({
  programId: ix.programAddress, data: Buffer.from(ix.data ?? new Uint8Array()).toString('base64'),
  accounts: (ix.accounts ?? []).map(a => ({ pubkey: a.address, isSigner: a.role >= 2, isWritable: a.role === 1 || a.role === 3 })),
});

/**
 * Orca on devnet, shaped like the Jupiter client so the signer's validation and limits apply unchanged.
 * Instructions come from Orca's SDK on this machine, not from a third-party API. SOL is wrapped through the wallet's own
 * associated account (never a throwaway keypair), which is exactly what the validator allows.
 */
export function orcaDevnetApi(rpcUrl: string, wallet: string): JupiterApi {
  setNativeMintWrappingStrategy('ata');
  const rpc = createSolanaRpc(devnet(rpcUrl));
  const cache = new Map<string, SwapPlan>();
  return {
    async quote(p) {
      if (p.inputMint !== WSOL && p.inputMint !== DEVNET_USDC) throw new Error('Only SOL and devUSDC trade on devnet');
      const { instructions, quote } = await swapInstructions(rpc, { inputAmount: p.amount, mint: address(p.inputMint) }, address(ORCA_DEVNET_POOL),
        { slippageToleranceBps: p.slippageBps, signer: createNoopSigner(address(wallet)), whirlpoolDeployment: WhirlpoolDeployment.devnet });
      const ixs = instructions.map(toJupIx), at = ixs.findIndex(i => i.programId === ORCA_PROGRAM);
      if (at < 0) throw new Error('Orca returned no swap instruction');
      const out = BigInt(quote.tokenEstOut), min = BigInt(quote.tokenMinOut);
      const q: Quote = { inputMint: p.inputMint, inAmount: p.amount.toString(), outputMint: p.outputMint, outAmount: out.toString(), otherAmountThreshold: min.toString(),
        swapMode: 'ExactIn', slippageBps: p.slippageBps, priceImpactPct: '0', routePlan: [], platformFee: null };
      cache.set(`${q.inputMint}:${q.inAmount}:${q.slippageBps}`, { computeBudgetInstructions: [], setupInstructions: ixs.slice(0, at), swapInstruction: ixs[at],
        cleanupInstruction: ixs[at + 1] ?? null, otherInstructions: ixs.slice(at + 2), addressLookupTableAddresses: [] });
      return q;
    },
    async plan(q) {
      const plan = cache.get(`${q.inputMint}:${q.inAmount}:${q.slippageBps}`);
      if (!plan) throw new Error('No plan for this quote');
      return plan;
    },
  };
}

/** SOL priced from the pool itself (devnet has no market); devUSDC at one dollar. */
export function orcaDevnetPrices(rpcUrl: string): PriceApi {
  const rpc = createSolanaRpc(devnet(rpcUrl));
  return {
    async usd(mints) {
      const out = new Map<string, { usd: number; liquidityUsd: number }>();
      for (const m of mints) if (m === DEVNET_USDC) out.set(m, { usd: 1, liquidityUsd: Infinity });
      if (mints.includes(WSOL)) {
        const info = await rpc.getAccountInfo(address(ORCA_DEVNET_POOL), { encoding: 'base64' }).send();
        if (!info.value) throw new Error('Orca devnet pool not found');
        const data = Buffer.from(info.value.data[0], 'base64'), sqrt = data.readBigUInt64LE(65) + (data.readBigUInt64LE(73) << 64n);
        out.set(WSOL, { usd: (Number(sqrt) / 2 ** 64) ** 2 * 1000, liquidityUsd: Infinity }); // 1e9 / 1e6 decimals
      }
      return out;
    },
  };
}
