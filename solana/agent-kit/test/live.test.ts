import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { deriveAta } from '../src/ata';
import { jupiterApi } from '../src/jupiter';
import { USDC, USDT, WSOL } from '../src/policy';
import { validatePlan } from '../src/validate';

// Live check against Jupiter's public API (no money, no key): LIVE=1 pnpm test
const W = 'EET2cUX1nrFcQ12vBuyFsXfNACmSm1gs93jCsFiLvsSk';
// Some sandboxes let curl out but not Node's fetch, so this test goes through curl; the production code uses fetch.
const curlFetch = (async (url: string, init?: RequestInit) => {
  const args = ['-s', '-m', '20', '-w', '\n%{http_code}', ...(init?.method === 'POST' ? ['-X', 'POST', '-H', 'content-type: application/json', '-d', String(init.body)] : []), url];
  const out = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 20_000_000 }), i = out.lastIndexOf('\n');
  return new Response(out.slice(0, i), { status: Number(out.slice(i + 1)) });
}) as unknown as typeof fetch;
describe.skipIf(!process.env.LIVE)('real Jupiter plans pass the validator', () => {
  const jup = jupiterApi('https://lite-api.jup.ag/swap/v1', undefined, curlFetch);
  it.each([[WSOL, USDC, 100_000_000n], [USDC, WSOL, 5_000_000n], [WSOL, USDT, 50_000_000n], [USDC, USDT, 10_000_000n]])('%s -> %s', async (inMint, outMint, amount) => {
    const ata: Record<string, string> = { [inMint]: await deriveAta(W, inMint), [outMint]: await deriveAta(W, outMint), [WSOL]: await deriveAta(W, WSOL) };
    const q = await jup.quote({ inputMint: inMint, outputMint: outMint, amount, slippageBps: 50 });
    const plan = await jup.plan(q, W, outMint === WSOL ? ata[WSOL] : ata[outMint], 200_000);
    const v = validatePlan(plan, { wallet: W, inMint, outMint, amountIn: amount, ata, wsol: ata[WSOL], maxPriorityLamports: 200_000, maxTipLamports: 0 });
    expect(v, JSON.stringify(v)).toMatchObject({ ok: true });
  }, 30_000);
});
