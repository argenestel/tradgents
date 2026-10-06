import { setTimeout as sleep } from 'node:timers/promises';
import { STABLES, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL, type Config } from './config';
import { Indexer } from './indexer';
import { analyze, replay, valueBalances, type ChainTx, type Opening } from './ledger';
import { log } from './log';
import type { PriceSource } from './prices';
import type { Rpc } from './rpc';
import { buildStats } from './stats';
import type { Flags, Store } from './store';
import type { Agent } from './types';

/** Bump when ledger math changes so stored trades and equity are re-derived from raw transactions. */
export const REPLAY_VERSION = '5';
export const WORKER_LOCK = 7_261_002;
const DEPEG_BAND = 0.015, SAMPLE_EVERY_MS = 30_000, MARK_EVERY_MS = 300_000, STALE_PRICE_MS = 10 * 60_000;

type SigInfo = { signature: string; slot: number; err: unknown; blockTime: number | null };
export interface Chain { slot: number; balances: Map<string, bigint>; decimals: Map<string, number>; tokenAccounts: number }

/** Native SOL, wSOL and every SPL / Token-2022 balance, all read at one slot. */
export async function readChain(rpc: Rpc, wallet: string): Promise<Chain> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bal = await rpc.call<{ context: { slot: number }; value: number }>('getBalance', [wallet, { commitment: 'finalized' }]);
    const parts = await Promise.all([TOKEN_PROGRAM, TOKEN_2022_PROGRAM].map(programId => rpc.call<{ context: { slot: number }; value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } }[] }>(
      'getTokenAccountsByOwner', [wallet, { programId }, { encoding: 'jsonParsed', commitment: 'finalized' }])));
    if (parts.some(p => p.context.slot !== bal.context.slot)) { await sleep(400); continue; } // balances from different slots can double count or miss a trade
    const balances = new Map<string, bigint>([[WSOL, BigInt(bal.value)]]), decimals = new Map<string, number>([[WSOL, 9]]);
    let tokenAccounts = 0;
    for (const p of parts) for (const t of p.value) {
      const i = t.account.data.parsed.info;
      balances.set(i.mint, (balances.get(i.mint) ?? 0n) + BigInt(i.tokenAmount.amount)); decimals.set(i.mint, i.tokenAmount.decimals); tokenAccounts++;
    }
    return { slot: bal.context.slot, balances, decimals, tokenAccounts };
  }
  throw new Error('Could not read wallet balances at a single slot');
}

/** Store every transaction newer than the cursor (and newer than `afterSlot`), failed ones included: they still paid a fee. */
export async function pollWallet(store: Store, rpc: Rpc, agent: Agent, afterSlot: number): Promise<number> {
  const key = `wallet-head:${agent.slug}`, head = await store.state(key);
  const fresh: SigInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await rpc.call<SigInfo[]>('getSignaturesForAddress', [agent.wallet, { commitment: 'finalized', limit: 1000, ...(before ? { before } : {}), ...(head ? { until: head } : {}) }]);
    fresh.push(...page.filter(p => p.slot > afterSlot));
    if (page.length < 1000 || page.some(p => p.slot <= afterSlot)) break;
    before = page.at(-1)!.signature;
  }
  let stored = 0;
  for (const info of fresh.reverse()) { // oldest first, so a failure leaves the cursor behind the gap
    const tx = await rpc.call<ChainTx | null>('getTransaction', [info.signature, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 1 }]);
    if (!tx || tx.blockTime == null) throw new Error(`Transaction not yet available: ${info.signature}`);
    await store.tx(async s => { stored += Number(await s.putRaw(info.signature, agent.wallet, tx.slot, tx.blockTime! * 1000, tx)); await s.setState(key, info.signature); });
  }
  return stored;
}

/** The track record starts when the agent registers: record what it held then, at a known slot. */
export async function ensureOpening(store: Store, rpc: Rpc, prices: PriceSource, agent: Agent, now: number): Promise<Opening & { tokenAccounts: number }> {
  const existing = await store.opening(agent.slug);
  if (existing) return { ...existing, rentAccounts: Number(await store.state(`opening-rent:${agent.slug}`) ?? 0), tokenAccounts: 0 };
  const chain = await readChain(rpc, agent.wallet);
  const quotes = await prices.get([...chain.balances.keys()].filter(m => (chain.balances.get(m) ?? 0n) > 0n));
  const priceMap: Record<string, number> = {};
  for (const [m, q] of quotes) priceMap[m] = q.usd;
  const balances = Object.fromEntries([...chain.balances].map(([m, raw]) => [m, { raw: raw.toString(), decimals: chain.decimals.get(m) ?? 0 }]));
  await store.tx(async s => {
    await s.putOpening(agent.slug, { slot: chain.slot, tsMs: now, balances, prices: priceMap });
    await s.setState(`opening-rent:${agent.slug}`, String(chain.tokenAccounts));
    await s.putSamples([...quotes].map(([mint, q]) => ({ mint, ts: now, usd: q.usd, liquidity: Number.isFinite(q.liquidityUsd) ? q.liquidityUsd : null, source: q.source })));
  });
  return { slot: chain.slot, tsMs: now, balances, prices: priceMap, rentAccounts: chain.tokenAccounts, tokenAccounts: chain.tokenAccounts };
}

export async function symbolFor(store: Store, mint: string, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  const cached = await store.state(`symbol:${mint}`);
  if (cached !== undefined) return cached || undefined;
  if (Object.hasOwn(STABLES, mint) || mint === WSOL) return undefined;
  try {
    const res = await fetcher(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { signal: AbortSignal.timeout(8000) });
    const rows = res.ok ? await res.json() as { id: string; symbol?: string }[] : [];
    const sym = rows.find(r => r.id === mint)?.symbol?.replace(/[^\w$.-]/g, '').slice(0, 12);
    await store.setState(`symbol:${mint}`, sym ?? '');
    return sym;
  } catch { return undefined; }
}

/** Deposits and positions we cannot explain are never guessed at: they become flags that block ranking. */
export async function rebuild(store: Store, agent: Agent, prices: { sampleSince: number; registryProgram?: string }, now: number): Promise<{ balances: Map<string, bigint>; rentAccounts: number; flags: Flags } | undefined> {
  const opening = await store.opening(agent.slug);
  if (!opening) return undefined;
  const rent = Number(await store.state(`opening-rent:${agent.slug}`) ?? 0);
  const raws = await store.rawFor(agent.wallet, opening.slot);
  const facts = raws.flatMap(r => { const f = analyze(agent.wallet, r.signature, r.data as ChainTx, new Set(prices.registryProgram ? [prices.registryProgram] : [])); return f ? [f] : []; });
  const mints = [...new Set([WSOL, ...Object.keys(opening.balances), ...facts.flatMap(f => [...f.actual.keys()])])];
  const samples = await store.samples(mints, Math.min(opening.tsMs, prices.sampleSince) - 3_600_000);
  const symbols = new Map<string, string>();
  for (const m of mints) { const s = await symbolFor(store, m); if (s) symbols.set(m, s); }
  const result = replay(agent, facts, { opening: { ...opening, rentAccounts: rent }, samples, symbols });
  await store.replaceDerived(agent.slug, { trades: result.trades, posts: result.posts, points: result.points });
  const first = result.points[0];
  await store.updateAgent({ ...agent, startedAt: first ? first.ts : agent.startedAt, status: result.points.length && now - result.points.at(-1)!.ts < 7 * 86_400_000 ? 'live' : 'stale',
    protocols: [...new Set([...agent.protocols, ...result.trades.map(t => t.protocol)])] });
  return { balances: result.balances, rentAccounts: result.rentAccounts, flags: { unsupportedTs: result.unsupported.map(u => u.ts), unpricedTouchTs: result.unpricedTouches.map(u => u.ts), unpricedHeld: result.unpriced, drift: false } };
}

/** Registry events become the on-chain verification badge and bond shown on the profile. */
export async function projectRegistry(store: Store): Promise<number> {
  const bonds = new Map<string, number>();
  for (const e of await store.registryEvents()) {
    const wallet = e.fields.agent_wallet as string | undefined;
    if (!wallet) continue;
    if (e.name === 'AgentRegistered') bonds.set(wallet, Number(e.fields.bond) / 1e9);
    else if (e.name === 'BondWithdrawn' || e.name === 'AgentSlashed') bonds.set(wallet, 0);
  }
  let changed = 0;
  for (const [wallet, bondSol] of bonds) {
    const agent = await store.agentByWallet(wallet);
    if (!agent || (agent.bondSol === bondSol && agent.verification !== 'declared')) continue;
    await store.updateAgent({ ...agent, bondSol, verification: agent.verification === 'declared' ? 'wallet_signed' : agent.verification });
    changed++;
  }
  return changed;
}

export interface WorkerDeps { store: Store; rpc: Rpc; prices: PriceSource; cfg: Pick<Config, 'programId' | 'POLL_SECONDS'>; now?: () => number }
export function createWorker(d: WorkerDeps) {
  const now = d.now ?? Date.now, registry = new Indexer(d.store, d.rpc, d.cfg.programId);

  /** Sample SOL and everything agents hold, at most every SAMPLE_EVERY_MS. Replays read these samples, never a live price. */
  async function sample(): Promise<void> {
    const last = Number(await d.store.state('sampled') ?? 0);
    if (now() - last < SAMPLE_EVERY_MS) return;
    const held = new Set<string>([WSOL]);
    for (const a of await d.store.agents()) for (const m of JSON.parse(await d.store.state(`held:${a.slug}`) ?? '[]') as string[]) held.add(m);
    const q = await d.prices.get([...held]);
    if (!q.has(WSOL)) throw new Error('No SOL price: refusing to mark anything this cycle');
    const dev = await d.prices.stableDeviation?.().catch(() => undefined);
    if (dev !== undefined && dev > DEPEG_BAND) { const prior = JSON.parse(await d.store.state('depeg-times') ?? '[]') as number[]; await d.store.setState('depeg-times', JSON.stringify([...prior.filter(t => t > now() - 35 * 86_400_000), now()])); log.warn({ deviation: dev }, 'stablecoin off its peg'); }
    await d.store.putSamples([...q].map(([mint, p]) => ({ mint, ts: now(), usd: p.usd, liquidity: Number.isFinite(p.liquidityUsd) ? p.liquidityUsd : null, source: p.source })));
    await d.store.setState('sampled', String(now()));
  }

  async function agentCycle(agent: Agent): Promise<void> {
    const t = now();
    const opening = await ensureOpening(d.store, d.rpc, d.prices, agent, t);
    const added = await pollWallet(d.store, d.rpc, agent, opening.slot);
    const stale = (await d.store.state(`rebuilt:${agent.slug}`)) !== REPLAY_VERSION;
    const lastMark = Number(await d.store.state(`marked:${agent.slug}`) ?? 0);
    if (!added && !stale && t - lastMark < MARK_EVERY_MS) return;
    const built = await rebuild(d.store, (await d.store.agent(agent.slug))!, { sampleSince: opening.tsMs, registryProgram: d.cfg.programId }, t);
    if (!built) return;
    await d.store.setState(`rebuilt:${agent.slug}`, REPLAY_VERSION);
    // Mark at a single slot and compare with what the ledger believes. A mismatch twice in a row is flagged and blocks ranking.
    const chain = await readChain(d.rpc, agent.wallet);
    await d.store.setState(`held:${agent.slug}`, JSON.stringify([...chain.balances].filter(([, v]) => v > 0n).map(([m]) => m)));
    const tip = await d.rpc.call<SigInfo[]>('getSignaturesForAddress', [agent.wallet, { commitment: 'finalized', limit: 1 }]);
    if (!tip.length || tip[0].signature === await d.store.state(`wallet-head:${agent.slug}`)) { // nothing newer than what we replayed
      const diff = [...new Set([...chain.balances.keys(), ...built.balances.keys()])].filter(m => (chain.balances.get(m) ?? 0n) !== (built.balances.get(m) ?? 0n));
      if (diff.length) { await d.store.setState(`drift:${agent.slug}`, '1'); log.warn({ agent: agent.slug, mints: diff.map(m => m.slice(0, 6)) }, 'ledger differs from chain'); }
      else await d.store.setState(`drift:${agent.slug}`, '0');
    }
    built.flags.drift = (await d.store.state(`drift:${agent.slug}`)) === '1'; // persisted: a restart does not make a mismatch look fine
    built.flags.depegTs = JSON.parse(await d.store.state('depeg-times') ?? '[]') as number[];
    const solSamples = await d.store.latestSample(WSOL);
    if (!solSamples || t - solSamples.ts > STALE_PRICE_MS) throw new Error('SOL price is stale; not marking');
    const px = async (m: string) => { if (Object.hasOwn(STABLES, m)) return 1; const s = await d.store.latestSample(m); return s && t - s.ts <= STALE_PRICE_MS ? s.usd : undefined; };
    const priced = new Map<string, number>();
    for (const m of chain.balances.keys()) { const p = await px(m); if (p !== undefined) priced.set(m, p); }
    const mark = valueBalances(chain.balances, chain.decimals, built.rentAccounts, m => priced.get(m));
    built.flags.unpricedHeld = mark.unpriced;
    await d.store.putMark(agent.slug, { t, usd: mark.usd, sol: solSamples.usd });
    await d.store.setState(`marked:${agent.slug}`, String(t));
    const fresh = (await d.store.agent(agent.slug))!;
    await d.store.putStats(agent.slug, buildStats(fresh, await d.store.equity(agent.slug), await d.store.trades(agent.slug), built.flags, t), t);
    if (added) log.info({ agent: agent.slug, added }, 'indexed new transactions');
  }

  async function cycle(lost?: AbortSignal): Promise<void> {
    await sample();
    try { await registry.poll(); await projectRegistry(d.store); } catch (e) { log.error({ err: (e as Error).message }, 'registry poll failed'); }
    for (const agent of await d.store.agents()) {
      if (lost?.aborted) throw new Error('stopping: the worker was asked to stop or lost its lock');
      if (agent.verification === 'declared') continue; // not claimed yet: nobody has proven the wallet, so do not spend RPC on it
      try { await agentCycle(agent); } catch (e) { log.error({ agent: agent.slug, err: (e as Error).message }, 'agent cycle failed; will retry'); }
    }
    await d.store.setState('lastCycle', String(now()));
  }
  async function run(signal: AbortSignal) {
    while (!signal.aborted) {
      try { await cycle(signal); } catch (e) { log.error({ err: (e as Error).message }, 'worker cycle failed'); }
      try { await sleep(d.cfg.POLL_SECONDS * 1000, undefined, { signal }); } catch { /* aborted */ }
    }
  }
  return { cycle, run };
}
