import { setTimeout as sleep } from 'node:timers/promises';
import { ORCA_POOL, LAMPORTS, REGISTRY_PROGRAM, RPC_URL, USDC, USDC_UNIT, WSOL } from './devnet';
import type { Store } from './db';
import { Indexer } from './indexer';
import { priceFromWhirlpool } from './pool';
import { Rpc } from './rpc';
import type { Agent } from './types';
import { rebuildAgent, type ChainTx } from './wallet';

type SigInfo = { signature: string; slot: number; err: unknown; blockTime: number | null };
/** Bump when the replay math changes so stored trades and equity are re-derived from the raw transactions. */
export const REPLAY_VERSION = '3';
export interface Pool { price: number; feeRate: number; at: number }

export async function fetchPool(rpc: Rpc): Promise<Pool> {
  const info = await rpc.call<{ value: { data: [string, string] } | null }>('getAccountInfo', [ORCA_POOL, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!info.value) throw new Error('Orca pool account not found');
  const data = Buffer.from(info.value.data[0], 'base64');
  return { price: priceFromWhirlpool(data), feeRate: data.readUInt16LE(45) / 1e6, at: Date.now() };
}

/** Fetch and store every transaction touching the wallet that we have not seen. Returns the number stored. */
export async function pollWallet(store: Store, rpc: Rpc, wallet: string): Promise<number> {
  const key = `wallet-head:${wallet}`, head = store.state(key);
  const fresh: SigInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await rpc.call<SigInfo[]>('getSignaturesForAddress', [wallet, { commitment: 'confirmed', limit: 1000, ...(before ? { before } : {}), ...(head ? { until: head } : {}) }]);
    fresh.push(...page);
    if (page.length < 1000) break;
    before = page.at(-1)!.signature;
  }
  let stored = 0;
  for (const info of fresh.reverse()) { // oldest first so a failure leaves the cursor behind the gap
    if (info.err) continue;
    const tx = await rpc.call<ChainTx | null>('getTransaction', [info.signature, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 0 }]);
    if (!tx || tx.blockTime == null) throw new Error(`Transaction not yet available: ${info.signature}`);
    stored += Number(store.db.prepare('INSERT OR IGNORE INTO raw_transactions VALUES(?,?,?,?,?)').run(info.signature, wallet, tx.slot, tx.blockTime, JSON.stringify(tx)).changes);
    store.setState(key, info.signature); // cursor only moves past transactions we hold
  }
  return stored;
}

/** Current wallet value at the pool price: native SOL, wrapped SOL and devUSDC. */
export async function markWallet(store: Store, rpc: Rpc, agent: Agent, pool: Pool, now: number): Promise<number> {
  const [bal, tokens] = await Promise.all([
    rpc.call<{ value: number }>('getBalance', [agent.wallet, { commitment: 'confirmed' }]),
    rpc.call<{ value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string } } } } } }[] }>('getTokenAccountsByOwner',
      [agent.wallet, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
  ]);
  const amount = (mint: string) => tokens.value.filter(t => t.account.data.parsed.info.mint === mint).reduce((s, t) => s + Number(t.account.data.parsed.info.tokenAmount.amount), 0);
  const sol = (bal.value + amount(WSOL)) / LAMPORTS, usd = sol * pool.price + amount(USDC) / USDC_UNIT;
  const last = store.db.prepare('SELECT MAX(ts) AS ts FROM equity WHERE agent=?').get(agent.slug) as { ts: number | null };
  if (last.ts === null) return usd; // nothing to compare against until the first transaction is indexed
  store.putEquity(agent.slug, { t: Math.max(now, last.ts + 1), usd: Number(usd.toFixed(6)), sol: Number(pool.price.toFixed(6)) }, 0, 'mark');
  return usd;
}

/** Registry events become the on-chain verification badge and bond shown on the profile. */
export function projectRegistry(store: Store): number {
  const events = store.db.prepare('SELECT data FROM registry_events ORDER BY slot,ix_index,event_index').all() as { data: string }[];
  const bonds = new Map<string, number>();
  for (const { data } of events) {
    const e = JSON.parse(data) as { name: string; fields: Record<string, string | boolean> };
    const wallet = e.fields.agent_wallet as string | undefined;
    if (!wallet) continue;
    if (e.name === 'AgentRegistered') bonds.set(wallet, Number(e.fields.bond) / LAMPORTS);
    else if (e.name === 'BondWithdrawn' || e.name === 'AgentSlashed') bonds.set(wallet, 0);
  }
  let changed = 0;
  for (const [wallet, bondSol] of bonds) {
    const agent = store.wallet(wallet);
    if (!agent || (agent.bondSol === bondSol && agent.verification !== 'declared')) continue;
    store.updateAgent({ ...agent, bondSol, verification: agent.verification === 'declared' ? 'wallet_signed' : agent.verification });
    changed++;
  }
  return changed;
}

export interface Worker { cycle(): Promise<void>; run(signal: AbortSignal): Promise<void> }
export function createWorker(store: Store, opts: { rpcUrl?: string; programId?: string; intervalSeconds?: number; markEveryMs?: number } = {}): Worker {
  const rpc = new Rpc(opts.rpcUrl ?? RPC_URL), registry = new Indexer(store, opts.rpcUrl ?? RPC_URL, opts.programId ?? REGISTRY_PROGRAM);
  const markEvery = opts.markEveryMs ?? 300_000;
  const cycle = async () => {
    const pool = await fetchPool(rpc);
    store.setState('pool', JSON.stringify(pool));
    try { await registry.poll(); projectRegistry(store); } catch (e) { console.error('registry poll failed:', (e as Error).message); }
    for (const agent of store.agents()) {
      try {
        const added = await pollWallet(store, rpc, agent.wallet);
        const trigger = added > 0 || store.state(`rebuilt:${agent.slug}`) !== REPLAY_VERSION;
        if (trigger) { rebuildAgent(store, agent.slug, { feeRate: pool.feeRate, price: pool.price }); store.setState(`rebuilt:${agent.slug}`, REPLAY_VERSION); }
        const lastMark = Number(store.state(`marked:${agent.slug}`) ?? 0);
        if (trigger || Date.now() - lastMark >= markEvery) { await markWallet(store, rpc, agent, pool, Date.now()); store.setState(`marked:${agent.slug}`, String(Date.now())); }
        if (added) console.log(`${agent.slug}: indexed ${added} new transaction(s)`);
      } catch (e) { console.error(`${agent.slug}: indexing failed, will retry:`, (e as Error).message); }
    }
    store.setState('lastCycle', String(Date.now()));
  };
  const run = async (signal: AbortSignal) => {
    while (!signal.aborted) {
      try { await cycle(); } catch (e) { console.error('worker cycle failed:', (e as Error).message); }
      try { await sleep((opts.intervalSeconds ?? 10) * 1000, undefined, { signal }); } catch { /* aborted */ }
    }
  };
  return { cycle, run };
}
