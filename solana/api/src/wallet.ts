import { LAMPORTS, ORCA_POOL, ORCA_PROGRAM, USDC, USDC_UNIT, WSOL } from './devnet';
import type { Store } from './db';
import type { Agent, Interaction, PnlComponent, Post } from './types';

/** The subset of `getTransaction(encoding: json)` the analysis needs. */
export interface ChainTx {
  slot: number;
  blockTime: number | null;
  transaction: { message: { accountKeys: string[] } };
  meta: {
    err: unknown; fee: number; preBalances: number[]; postBalances: number[]; logMessages: string[] | null;
    preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[];
  } | null;
}
export interface TokenBalance { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }

export interface TxFacts {
  signature: string; ts: number; slot: number; fee: number; // fee in lamports, only if this wallet paid it
  /** Native SOL balance after the transaction, in whole units. Token balances only appear in a transaction that touches them, so devUSDC is carried as a running sum of deltas. */
  solAfter: number;
  /** Net change of the wallet excluding the network fee, in whole units. */
  solDelta: number; usdcDelta: number;
  /** Set when the transaction swapped against the tracked Orca pool: pool-side deltas are the exact traded amounts. */
  swap?: { solIn: number; usdcOut: number };
}

const sum = (xs: TokenBalance[] | undefined, owner: string, mint: string) =>
  (xs ?? []).filter(b => b.owner === owner && b.mint === mint).reduce((s, b) => s + Number(b.uiTokenAmount.amount), 0);

/** Pure extraction of what happened to one wallet in one transaction. Returns undefined for failed transactions. */
export function analyze(wallet: string, signature: string, tx: ChainTx): TxFacts | undefined {
  const meta = tx.meta;
  if (!meta || meta.err || tx.blockTime == null) return undefined;
  const keys = tx.transaction.message.accountKeys, i = keys.indexOf(wallet);
  if (i < 0) return undefined;
  const fee = i === 0 ? meta.fee : 0;
  const solPre = meta.preBalances[i], solPost = meta.postBalances[i];
  const usdcPre = sum(meta.preTokenBalances, wallet, USDC), usdcPost = sum(meta.postTokenBalances, wallet, USDC);
  const facts: TxFacts = { signature, ts: tx.blockTime * 1000, slot: tx.slot, fee,
    solAfter: solPost / LAMPORTS,
    solDelta: (solPost - solPre + fee) / LAMPORTS, usdcDelta: (usdcPost - usdcPre) / USDC_UNIT };
  const orca = (meta.logMessages ?? []).some(l => l === `Program ${ORCA_PROGRAM} invoke [1]` || l.startsWith(`Program ${ORCA_PROGRAM} invoke [`));
  if (orca) {
    const solIn = (sum(meta.postTokenBalances, ORCA_POOL, WSOL) - sum(meta.preTokenBalances, ORCA_POOL, WSOL)) / LAMPORTS;
    const usdcIn = (sum(meta.postTokenBalances, ORCA_POOL, USDC) - sum(meta.preTokenBalances, ORCA_POOL, USDC)) / USDC_UNIT;
    // Pool vault balances are owned by the pool account; a swap moves one side in and the other out.
    if (solIn * usdcIn < 0 && Math.abs(usdcIn + facts.usdcDelta) < 1e-6) facts.swap = { solIn, usdcOut: -usdcIn };
  }
  return facts;
}

const round = (n: number, d = 8) => Number(n.toFixed(d));

export interface ReplayResult { interactions: Interaction[]; posts: Post[]; points: { ts: number; usd: number; sol: number; flow: number }[]; netFlowUsd: number }

/**
 * Deterministic replay of an agent's wallet history, oldest first.
 * SOL is the traded asset and devUSDC is cash. FIFO lots track SOL cost basis; deposits open a lot at the price of the
 * moment, withdrawals consume lots without realizing PnL. Pool fees are expensed at the time of the swap and kept out of
 * the lot basis, so "price" PnL and "swapFee" add up to exactly what the wallet gained or lost.
 */
export function replay(agent: Agent, facts: TxFacts[], opts: { feeRate: number; fallbackPrice: number }): ReplayResult {
  const lots: { qty: number; price: number }[] = [];
  const out: ReplayResult = { interactions: [], posts: [], points: [], netFlowUsd: 0 };
  let last = opts.fallbackPrice, usdcBalance = 0;
  const consume = (qty: number, price: number) => { // returns cost basis consumed
    let left = qty, cost = 0;
    while (left > 1e-12 && lots.length) {
      const lot = lots[0], take = Math.min(lot.qty, left);
      cost += take * lot.price; lot.qty -= take; left -= take;
      if (lot.qty <= 1e-12) lots.shift();
    }
    return cost + left * price; // any shortfall carries no gain or loss
  };
  const used = new Set<number>();
  for (const f of [...facts].sort((a, b) => a.slot - b.slot || a.ts - b.ts)) {
    let ts = f.ts; while (used.has(ts)) ts++; used.add(ts);
    const feeUsd = f.fee / LAMPORTS * last;
    let flow = 0;
    if (f.swap) {
      const solQty = Math.abs(f.swap.solIn), usdcQty = Math.abs(f.swap.usdcOut), sold = f.swap.solIn > 0; // pool received SOL => the agent sold
      const price = usdcQty / solQty, mid = sold ? price / (1 - opts.feeRate) : price * (1 - opts.feeRate); last = mid; // value holdings at the pool's mid price, not the fee-laden fill
      const rate = opts.feeRate, components: { label: PnlComponent; usd: number }[] = [];
      let fee: number, priceUsd = 0;
      if (sold) { // the pool takes its fee from the SOL input, so USDC received is already net
        const gross = usdcQty / (1 - rate); fee = gross - usdcQty;
        priceUsd = gross - consume(solQty, mid);
      } else { // the fee comes out of the USDC input; the remainder is the lot's cost
        fee = usdcQty * rate;
        lots.push({ qty: solQty, price: usdcQty * (1 - rate) / solQty });
      }
      if (priceUsd !== 0) components.push({ label: 'price', usd: round(priceUsd, 6) });
      if (fee > 0) components.push({ label: 'swapFee', usd: -round(fee, 6) });
      if (feeUsd > 0) components.push({ label: 'priorityFee', usd: -round(feeUsd, 6) });
      const pnl = components.reduce((s, c) => s + c.usd, 0);
      const sol = sold ? -solQty : solQty, usdc = sold ? usdcQty : -usdcQty;
      out.interactions.push({ id: f.signature, agentSlug: agent.slug, signature: f.signature, ts, protocol: 'orca', kind: 'swap',
        legs: [{ symbol: 'SOL', delta: round(sol), usd: round(sol * mid, 6) }, { symbol: 'USDC', delta: round(usdc, 6), usd: round(usdc, 6) }],
        notionalUsd: round(usdcQty, 6), pnlUsd: round(pnl, 6), components, meta: { pair: sold ? 'SOL → USDC' : 'USDC → SOL', market: 'SOL/USDC' } });
      out.posts.push({ id: `trade:${f.signature}`, ts, agentSlug: agent.slug, type: 'trade', interactionId: f.signature, reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 });
    } else if (Math.abs(f.solDelta) > 1e-9 || Math.abs(f.usdcDelta) > 1e-9) {
      // Not a trade on the tracked venue: treat as a deposit or withdrawal at the price of the moment.
      flow = f.solDelta * last + f.usdcDelta;
      if (f.solDelta > 0) lots.push({ qty: f.solDelta, price: last });
      else if (f.solDelta < 0) consume(-f.solDelta, last);
    }
    // Network fees are a cost of doing business, so they stay in equity (not a flow) and are charged to a trade when there is one.
    out.netFlowUsd += flow;
    usdcBalance += f.usdcDelta;
    out.points.push({ ts, usd: round(f.solAfter * last + usdcBalance, 6), sol: round(last, 6), flow: round(flow, 6) });
  }
  return out;
}

/** Re-derive trades, trade posts and per-transaction equity points for one agent from the stored raw transactions. */
export function rebuildAgent(store: Store, slug: string, opts: { feeRate: number; price: number }): number {
  const agent = store.agent(slug);
  if (!agent) return 0;
  const rows = store.db.prepare('SELECT signature,data FROM raw_transactions WHERE wallet=? ORDER BY slot').all(agent.wallet) as { signature: string; data: string }[];
  const facts = rows.flatMap(r => { const f = analyze(agent.wallet, r.signature, JSON.parse(r.data) as ChainTx); return f ? [f] : []; });
  const result = replay(agent, facts, { feeRate: opts.feeRate, fallbackPrice: opts.price });
  store.transaction(() => {
    store.db.prepare('DELETE FROM trades WHERE agent=?').run(slug);
    store.db.prepare("DELETE FROM posts WHERE agent=? AND id LIKE 'trade:%'").run(slug);
    store.db.prepare("DELETE FROM equity WHERE agent=? AND src='tx'").run(slug);
    for (const i of result.interactions) store.putTrade(i);
    for (const p of result.posts) store.putPost(p);
    for (const p of result.points) store.putEquity(slug, { t: p.ts, usd: p.usd, sol: p.sol }, p.flow, 'tx');
    const first = result.points[0];
    const next: Agent = { ...agent, startedAt: first ? Math.min(agent.startedAt, first.ts) : agent.startedAt,
      status: result.points.length && Date.now() - result.points.at(-1)!.ts < 7 * 86_400_000 ? 'live' : 'stale',
      protocols: result.interactions.length ? [...new Set<Agent['protocols'][number]>([...agent.protocols, 'orca'])] : agent.protocols };
    store.updateAgent(next);
  });
  return result.interactions.length;
}
