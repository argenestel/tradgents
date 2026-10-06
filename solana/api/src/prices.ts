import { STABLES, WSOL } from './config';

export interface PriceQuote { usd: number; liquidityUsd: number; source: string }
export interface PriceSource { get(mints: string[]): Promise<Map<string, PriceQuote>> }

export const isStable = (mint: string) => Object.hasOwn(STABLES, mint);

/**
 * Jupiter Price API v3. Stablecoins are fixed at $1 without a lookup. Anything thinner than
 * `minLiquidityUsd` is left out on purpose: a price you cannot exit at is not a price.
 */
export class JupiterPrices implements PriceSource {
  constructor(private readonly opts: { baseUrl?: string; apiKey?: string; minLiquidityUsd: number; fetcher?: typeof fetch }) {}
  async get(mints: string[]): Promise<Map<string, PriceQuote>> {
    const out = new Map<string, PriceQuote>();
    const need = [...new Set(mints)].filter(m => { if (isStable(m)) { out.set(m, { usd: 1, liquidityUsd: Infinity, source: 'stable' }); return false; } return true; });
    const base = this.opts.baseUrl ?? (this.opts.apiKey ? 'https://api.jup.ag/price/v3' : 'https://lite-api.jup.ag/price/v3');
    const doFetch = this.opts.fetcher ?? fetch;
    for (let i = 0; i < need.length; i += 50) {
      const ids = need.slice(i, i + 50);
      const res = await doFetch(`${base}?ids=${ids.join(',')}`, { headers: this.opts.apiKey ? { 'x-api-key': this.opts.apiKey } : {}, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Jupiter price HTTP ${res.status}`);
      const body = await res.json() as Record<string, { usdPrice?: number; liquidity?: number } | null>;
      for (const id of ids) {
        const q = body[id];
        if (q && Number.isFinite(q.usdPrice) && (q.usdPrice as number) > 0 && (q.liquidity ?? 0) >= this.opts.minLiquidityUsd)
          out.set(id, { usd: q.usdPrice as number, liquidityUsd: q.liquidity ?? 0, source: 'jupiter' });
      }
    }
    return out;
  }
}

/** Devnet has no market. The only meaningful price is the Orca devnet SOL/devUSDC pool's own price. */
export class FixedPrices implements PriceSource {
  constructor(private readonly prices: Record<string, number>) {}
  async get(mints: string[]) {
    const out = new Map<string, PriceQuote>();
    for (const m of mints) { if (isStable(m)) out.set(m, { usd: 1, liquidityUsd: Infinity, source: 'stable' }); else if (this.prices[m]) out.set(m, { usd: this.prices[m], liquidityUsd: Infinity, source: 'fixed' }); }
    return out;
  }
}

/** Nearest sample in time wins; samples are stored by the worker, so replays are deterministic. */
export function nearestSample(samples: { ts: number; usd: number }[], ts: number): number | undefined {
  if (!samples.length) return undefined;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (samples[mid].ts < ts) lo = mid + 1; else hi = mid; }
  const a = samples[lo], b = samples[lo - 1];
  return b && Math.abs(b.ts - ts) <= Math.abs(a.ts - ts) ? b.usd : a.usd;
}
export { WSOL };
