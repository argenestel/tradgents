import type { SwapPlan } from './validate';

export interface Quote {
  inputMint: string; inAmount: string; outputMint: string; outAmount: string; otherAmountThreshold: string;
  swapMode: string; slippageBps: number; priceImpactPct: string; routePlan: unknown[]; platformFee?: unknown;
  [k: string]: unknown;
}
export interface JupiterApi {
  quote(p: { inputMint: string; outputMint: string; amount: bigint; slippageBps: number }): Promise<Quote>;
  plan(q: Quote, wallet: string, destinationTokenAccount: string, maxPriorityLamports: number): Promise<SwapPlan>;
}
export interface PriceApi { usd(mints: string[]): Promise<Map<string, { usd: number; liquidityUsd: number }>> }

const headers = (key?: string) => ({ 'content-type': 'application/json', ...(key ? { 'x-api-key': key } : {}) });
async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
  return await res.json() as T;
}

export function jupiterApi(base: string, apiKey?: string, f: typeof fetch = fetch): JupiterApi {
  return {
    async quote(p) {
      const q = new URLSearchParams({ inputMint: p.inputMint, outputMint: p.outputMint, amount: p.amount.toString(), slippageBps: String(p.slippageBps), restrictIntermediateTokens: 'true', swapMode: 'ExactIn' });
      return json<Quote>(await f(`${base}/quote?${q}`, { headers: headers(apiKey), signal: AbortSignal.timeout(10_000) }), 'Jupiter quote');
    },
    async plan(q, wallet, dest, maxPriorityLamports) {
      const body = { quoteResponse: q, userPublicKey: wallet, wrapAndUnwrapSol: true, destinationTokenAccount: dest, dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: maxPriorityLamports, priorityLevel: 'high' } } };
      return json<SwapPlan>(await f(`${base}/swap-instructions`, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) }), 'Jupiter swap-instructions');
    },
  };
}

export function priceApi(base: string, stable: Set<string>, apiKey?: string, f: typeof fetch = fetch): PriceApi {
  return {
    async usd(mints) {
      const out = new Map<string, { usd: number; liquidityUsd: number }>();
      const need = mints.filter(m => { if (stable.has(m)) { out.set(m, { usd: 1, liquidityUsd: Infinity }); return false; } return true; });
      if (need.length) {
        const body = await json<Record<string, { usdPrice?: number; liquidity?: number } | null>>(await f(`${base}?ids=${need.join(',')}`, { headers: headers(apiKey), signal: AbortSignal.timeout(10_000) }), 'Jupiter price');
        for (const m of need) { const q = body[m]; if (q?.usdPrice && q.usdPrice > 0) out.set(m, { usd: q.usdPrice, liquidityUsd: q.liquidity ?? 0 }); }
      }
      return out;
    },
  };
}
