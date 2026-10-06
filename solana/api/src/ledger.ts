import { INFRA_PROGRAMS, PROTOCOL_OF, STABLES, SWAP_PROGRAMS, TIP_ACCOUNTS, TOKEN_ACCOUNT_RENT, WSOL } from './config';
import { nearestSample } from './prices';
import type { Agent, Interaction, PnlComponent, Post, ProtocolId } from './types';

/** The part of `getTransaction(encoding: json, maxSupportedTransactionVersion: 0)` the ledger reads. */
export interface TokenBalance { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }
export interface ChainTx {
  slot: number;
  /** Position of the transaction inside its block; orders same-slot transactions the way the chain executed them. */
  transactionIndex?: number;
  blockTime: number | null;
  transaction: { message: { accountKeys: string[] } };
  meta: {
    err: unknown; fee: number; preBalances: number[]; postBalances: number[]; logMessages: string[] | null;
    loadedAddresses?: { writable: string[]; readonly: string[] };
    preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[];
  } | null;
}

export interface Facts {
  signature: string; slot: number; index: number; ts: number; ok: boolean;
  fee: bigint; tip: bigint;
  programs: string[];
  /** Programs the transaction called directly that are neither infrastructure nor a pinned swap venue. */
  foreign: string[];
  /** Real balance changes, including fee, tip and rent. Used to keep running balances equal to the chain. */
  actual: Map<string, bigint>;
  /** What the wallet economically gave or got: no fee, no tip, no account rent. Used to classify and value. */
  economic: Map<string, bigint>;
  decimals: Map<string, number>;
  /** Token accounts opened (+) or closed (-) by the wallet as fee payer; their rent is recoverable, so it is inventory. */
  rentAccounts: number;
  swapProgram: boolean;
}

/** Every program that ran (any depth) and the ones the wallet's transaction called directly (depth 1). */
function programsOf(logs: string[]) {
  const all = new Set<string>(), top = new Set<string>();
  for (const l of logs) { const m = /^Program (\S+) invoke \[(\d+)\]$/.exec(l); if (m) { all.add(m[1]); if (m[2] === '1') top.add(m[1]); } }
  return { all: [...all], top: [...top] };
}
const bump = (m: Map<string, bigint>, k: string, v: bigint) => { if (v !== 0n) m.set(k, (m.get(k) ?? 0n) + v); };

/** Pure extraction of what happened to one wallet in one transaction. Returns undefined when the wallet is not in it. */
export function analyze(wallet: string, signature: string, tx: ChainTx): Facts | undefined {
  const meta = tx.meta;
  if (!meta || tx.blockTime == null) return undefined;
  // balances are indexed over static keys, then loaded writable, then loaded readonly addresses
  const keys = [...tx.transaction.message.accountKeys, ...(meta.loadedAddresses?.writable ?? []), ...(meta.loadedAddresses?.readonly ?? [])], i = keys.indexOf(wallet);
  if (i < 0) return undefined;
  if (!meta.logMessages) throw new Error(`Transaction ${signature} has no logs; refusing to guess its programs`);
  if (meta.logMessages.some(l => l.includes('Log truncated'))) throw new Error(`Transaction ${signature} logs were truncated`);
  const payer = i === 0;
  const fee = payer ? BigInt(meta.fee) : 0n;
  const { all: programs, top } = programsOf(meta.logMessages);
  // Judge only what the wallet called directly: venues a supported router (Jupiter) routes through are its implementation detail.
  const base = { signature, slot: tx.slot, index: tx.transactionIndex ?? 0, ts: tx.blockTime * 1000, fee, programs,
    foreign: top.filter(p => !INFRA_PROGRAMS.has(p) && !SWAP_PROGRAMS.has(p)), swapProgram: top.some(p => SWAP_PROGRAMS.has(p)) };
  const decimals = new Map<string, number>([[WSOL, 9]]);
  const actual = new Map<string, bigint>(), economic = new Map<string, bigint>();
  if (meta.err) { // a failed transaction still paid its fee
    bump(actual, WSOL, -fee);
    return { ...base, ok: false, tip: 0n, actual, economic, decimals, rentAccounts: 0 };
  }
  bump(actual, WSOL, BigInt(meta.postBalances[i]) - BigInt(meta.preBalances[i]));
  const pre = new Map((meta.preTokenBalances ?? []).filter(b => b.owner === wallet).map(b => [b.accountIndex, b])), post = new Map((meta.postTokenBalances ?? []).filter(b => b.owner === wallet).map(b => [b.accountIndex, b]));
  for (const idx of new Set([...pre.keys(), ...post.keys()])) {
    const a = pre.get(idx), b = post.get(idx), mint = (b ?? a)!.mint;
    decimals.set(mint, (b ?? a)!.uiTokenAmount.decimals);
    bump(actual, mint, BigInt(b?.uiTokenAmount.amount ?? 0) - BigInt(a?.uiTokenAmount.amount ?? 0));
  }
  let tip = 0n;
  if (payer) keys.forEach((k, j) => { if (TIP_ACCOUNTS.has(k)) { const d = BigInt(meta.postBalances[j]) - BigInt(meta.preBalances[j]); if (d > 0n) tip += d; } });
  const created = payer ? [...post.keys()].filter(k => !pre.has(k)).length : 0, closed = payer ? [...pre.keys()].filter(k => !post.has(k)).length : 0;
  for (const [m, v] of actual) economic.set(m, v);
  bump(economic, WSOL, fee + tip + TOKEN_ACCOUNT_RENT * BigInt(created - closed));
  for (const [m, v] of [...economic]) if (v === 0n) economic.delete(m);
  return { ...base, ok: true, tip, actual, economic, decimals, rentAccounts: created - closed };
}

export interface Opening { slot: number; tsMs: number; balances: Record<string, { raw: string; decimals: number }>; prices: Record<string, number>; rentAccounts: number }
export interface ReplayContext {
  opening: Opening;
  samples: Map<string, { ts: number; usd: number }[]>;
  symbols: Map<string, string>;
}
export interface Unsupported { signature: string; ts: number; programs: string[] }
export interface Point { ts: number; usd: number; sol: number; flow: number }
export interface ReplayResult {
  trades: Interaction[]; posts: Post[]; points: Point[];
  unsupported: Unsupported[];
  /** Trades in tokens with no market sample: their equity effect cannot be measured, so the window they fall in is not rankable. */
  unpricedTouches: { signature: string; ts: number }[];
  /** Mints still held that have no defensible price. They are excluded from equity and block ranking. */
  unpriced: string[];
  /** The ledger's balances after the last transaction, raw units, for the integrity check against the chain. */
  balances: Map<string, bigint>;
  rentAccounts: number;
}

/** A price sample further than this from a transaction is not evidence of its price. */
const MAX_SAMPLE_GAP_MS = 10 * 60_000;
const round = (n: number, d = 6) => Number(n.toFixed(d));
const units = (raw: bigint, dec: number) => Number(raw) / 10 ** dec;
const short = (m: string) => `${m.slice(0, 4)}…${m.slice(-4)}`;
interface Lot { qty: number; unit: number }

/**
 * Deterministic replay of an agent's wallet from its opening snapshot. Same inputs, same outputs.
 * - Balances are bigint and always equal the chain's real balances (fee, tip, rent included).
 * - Cost basis is FIFO per asset. Prices come only from the stored samples, never from a live call.
 * - SOL and stablecoins can price a leg. A token with no sample is valued by what it traded for, or carried at cost.
 */
export function replay(agent: Pick<Agent, 'slug' | 'wallet'>, facts: Facts[], ctx: ReplayContext): ReplayResult {
  const balances = new Map<string, bigint>(), decimals = new Map<string, number>([[WSOL, 9]]), lots = new Map<string, Lot[]>();
  let lastSol = ctx.opening.prices[WSOL];
  let rentAccounts = ctx.opening.rentAccounts, currentSig = '';
  const out: ReplayResult = { trades: [], posts: [], points: [], unsupported: [], unpricedTouches: [], unpriced: [], balances, rentAccounts };
  const touched = new Set<string>();
  const unpricedTouch = (signature: string, ts: number) => { if (!touched.has(signature)) { touched.add(signature); out.unpricedTouches.push({ signature, ts }); } };
  const used = new Set<number>();
  const stamp = (t: number) => { while (used.has(t)) t++; used.add(t); return t; };

  const px = (mint: string, ts: number): number | undefined => {
    if (Object.hasOwn(STABLES, mint)) return 1;
    const s = nearestSample(ctx.samples.get(mint) ?? [], ts, MAX_SAMPLE_GAP_MS);
    if (mint === WSOL) { if (s !== undefined) lastSol = s; else if (currentSig) unpricedTouch(currentSig, ts); return s ?? lastSol; } // a SOL price gap is flagged, never silently guessed
    return s; // a token's mark comes from a stored market sample, never from what it just traded for
  };
  const push = (mint: string, qty: number, unit: number) => { if (qty > 0) (lots.get(mint) ?? lots.set(mint, []).get(mint)!).push({ qty, unit }); };
  let unknownBasis = false;
  const take = (mint: string, qty: number, fallbackUnit = 0): number => { // FIFO; returns the cost basis of what left
    const book = lots.get(mint) ?? [];
    let left = qty, cost = 0;
    while (left > 1e-12 && book.length) {
      const l = book[0], t = Math.min(l.qty, left);
      cost += t * l.unit; l.qty -= t; left -= t;
      if (l.qty <= 1e-12) book.shift();
    }
    // We hold no lot for the rest (an unpriced opening holding or deposit). Never read a missing cost as zero cost, which would be pure profit:
    // charge it at today's price so no gain is recorded, and block ranking until the window moves past this.
    if (left > 1e-9 * Math.max(1, qty)) { cost += left * fallbackUnit; unknownBasis = true; }
    return cost;
  };
  const value = (ts: number) => {
    let usd = 0;
    const solPx = px(WSOL, ts) ?? 0;
    for (const [m, raw] of balances) { const p = px(m, ts); if (p !== undefined && raw !== 0n) usd += units(raw, decimals.get(m) ?? 0) * p; }
    return { usd: usd + units(TOKEN_ACCOUNT_RENT * BigInt(Math.max(0, rentAccounts)), 9) * solPx, solPx };
  };

  for (const [m, b] of Object.entries(ctx.opening.balances)) {
    const raw = BigInt(b.raw); if (raw === 0n) continue;
    balances.set(m, raw); decimals.set(m, b.decimals);
    const p = Object.hasOwn(STABLES, m) ? 1 : ctx.opening.prices[m];
    if (p !== undefined) push(m, units(raw, b.decimals), p);
  }
  { const v = value(ctx.opening.tsMs); const ts = stamp(ctx.opening.tsMs); out.points.push({ ts, usd: round(v.usd), sol: round(v.solPx), flow: round(v.usd) }); }

  for (const f of [...facts].sort((a, b) => a.slot - b.slot || a.index - b.index || a.signature.localeCompare(b.signature))) {
    if (f.slot <= ctx.opening.slot) continue;
    const ts = stamp(f.ts); currentSig = f.signature;
    for (const [m, d] of f.decimals) decimals.set(m, d);
    for (const [m, v] of f.actual) balances.set(m, (balances.get(m) ?? 0n) + v);
    rentAccounts += f.rentAccounts;
    const solPx = px(WSOL, ts) ?? 0;
    const feeUsd = units(f.fee, 9) * solPx, tipUsd = units(f.tip, 9) * solPx;
    let flow = 0;
    const legs = [...f.economic].map(([mint, raw]) => ({ mint, qty: units(raw < 0n ? -raw : raw, decimals.get(mint) ?? 0), neg: raw < 0n }));
    const outs = legs.filter(l => l.neg), ins = legs.filter(l => !l.neg);

    if (f.ok && f.foreign.length) {
      // Unsupported activity (lending, LP, perps, unknown programs): stored and surfaced, valued at market as a flow so equity stays continuous.
      out.unsupported.push({ signature: f.signature, ts, programs: f.foreign });
      for (const l of legs) { const p = px(l.mint, ts); if (p === undefined) { unpricedTouch(f.signature, ts); continue; } flow += (l.neg ? -1 : 1) * l.qty * p; if (l.neg) take(l.mint, l.qty, p); else push(l.mint, l.qty, p); }
    } else if (f.ok && f.swapProgram && outs.length && ins.length) {
      const isNum = (m: string) => m === WSOL || Object.hasOwn(STABLES, m);
      const pNum = (m: string) => (isNum(m) ? px(m, ts) : undefined);
      const fair = (ls: typeof legs) => ls.reduce((s, l) => s + l.qty * (pNum(l.mint) ?? 0), 0);
      const unknownOuts = outs.filter(l => pNum(l.mint) === undefined), unknownIns = ins.filter(l => pNum(l.mint) === undefined);
      const components: { label: PnlComponent; usd: number }[] = [];
      let priceComp = 0, swapCost = 0, note: string | undefined, vol: number;
      const touchedUnpriced = [...outs, ...ins].some(l => px(l.mint, ts) === undefined);
      const inBasis = new Map<string, number>(); // total USD cost for each incoming mint

      if (!unknownOuts.length && !unknownIns.length) {
        const vo = fair(outs), vi = fair(ins), basis = outs.reduce((s, l) => s + take(l.mint, l.qty, pNum(l.mint) ?? 0), 0);
        swapCost = Math.max(0, vo - vi);
        priceComp = (swapCost > 0 ? vo : vi) - basis;
        for (const l of ins) inBasis.set(l.mint, l.qty * (pNum(l.mint) ?? 0));
        vol = Math.max(vo, vi);
      } else if (unknownIns.length === 1 && !unknownOuts.length) { // bought a token for SOL or a stablecoin
        const vo = fair(outs), basis = outs.reduce((s, l) => s + take(l.mint, l.qty, pNum(l.mint) ?? 0), 0), numIns = ins.filter(l => pNum(l.mint) !== undefined);
        priceComp = vo - basis;
        for (const l of numIns) inBasis.set(l.mint, l.qty * (pNum(l.mint) ?? 0));
        inBasis.set(unknownIns[0].mint, Math.max(0, vo - fair(numIns)));
        vol = vo;
      } else if (unknownOuts.length === 1 && !unknownIns.length) { // sold a token for SOL or a stablecoin
        const vi = fair(ins), unitOut = outs[0].qty > 0 ? vi / outs[0].qty : 0, basis = outs.reduce((s, l) => s + take(l.mint, l.qty, unitOut), 0);
        priceComp = vi - basis;
        for (const l of ins) inBasis.set(l.mint, l.qty * (pNum(l.mint) ?? 0));
        vol = vi;
      } else { // token for token, or several unknowns: nothing prices the exchange, so cost basis is carried over unrealized
        const basis = outs.reduce((s, l) => s + take(l.mint, l.qty, 0), 0), w = ins.map(l => l.qty * (pNum(l.mint) ?? 1)), tw = w.reduce((a, b) => a + b, 0) || 1;
        ins.forEach((l, k) => inBasis.set(l.mint, basis * w[k] / tw));
        note = 'Token-for-token swap: cost carried over, no gain or loss recorded until it is sold for SOL or a stablecoin';
        vol = basis;
      }
      for (const l of ins) push(l.mint, l.qty, l.qty > 0 ? (inBasis.get(l.mint) ?? 0) / l.qty : 0);
      if (priceComp !== 0) components.push({ label: 'price', usd: round(priceComp) });
      if (swapCost > 0) components.push({ label: 'swapFee', usd: -round(swapCost) });
      if (feeUsd > 0) components.push({ label: 'priorityFee', usd: -round(feeUsd) });
      if (tipUsd > 0) components.push({ label: 'tip', usd: -round(tipUsd) });
      if (touchedUnpriced) unpricedTouch(f.signature, ts);
      const sym = (m: string) => ctx.symbols.get(m) ?? (m === WSOL ? 'SOL' : STABLES[m] ?? short(m));
      const legsOut = [...outs.map(l => ({ l, s: -1 })), ...ins.map(l => ({ l, s: 1 }))].map(({ l, s }) => {
        const p = pNum(l.mint) ?? ((inBasis.get(l.mint) ?? 0) / (l.qty || 1));
        return { symbol: sym(l.mint), delta: round(s * l.qty, 9), usd: round(s * l.qty * p) };
      });
      const venue = f.programs.includes('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') ? 'jupiter' : PROTOCOL_OF.find(([p]) => f.programs.includes(p))?.[1] ?? 'other';
      const protocol: ProtocolId = venue;
      out.trades.push({ id: f.signature, agentSlug: agent.slug, signature: f.signature, ts, protocol, kind: 'swap', legs: legsOut,
        notionalUsd: round(vol), pnlUsd: round(components.reduce((s, c) => s + c.usd, 0)), components,
        meta: { pair: `${outs.map(l => sym(l.mint)).join(' + ')} → ${ins.map(l => sym(l.mint)).join(' + ')}`, market: 'spot', ...(note ? { note } : {}) } });
      out.posts.push({ id: `trade:${f.signature}`, ts, agentSlug: agent.slug, type: 'trade', interactionId: f.signature, reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 });
    } else if (f.ok) {
      // One-directional movement (or a swap program with only one side): a deposit or withdrawal, excluded from returns.
      for (const l of legs) { const p = px(l.mint, ts); if (p === undefined) { unpricedTouch(f.signature, ts); continue; } flow += (l.neg ? -1 : 1) * l.qty * p; if (l.neg) take(l.mint, l.qty, p); else push(l.mint, l.qty, p); }
    }
    if (unknownBasis) { unpricedTouch(f.signature, ts); unknownBasis = false; }
    const v = value(ts);
    out.points.push({ ts, usd: round(v.usd), sol: round(v.solPx), flow: round(flow) });
  }
  for (const [m, raw] of balances) if (raw > 0n && !Object.hasOwn(STABLES, m) && !ctx.samples.get(m)?.length && m !== WSOL) out.unpriced.push(m);
  out.rentAccounts = rentAccounts;
  return out;
}

/** Equity of raw balances at given prices, the same arithmetic the replay uses, for periodic marks. */
export function valueBalances(balances: Map<string, bigint>, decimals: Map<string, number>, rentAccounts: number, price: (mint: string) => number | undefined) {
  let usd = 0; const unpriced: string[] = [];
  for (const [m, raw] of balances) {
    if (raw <= 0n) continue;
    const p = price(m);
    if (p === undefined) unpriced.push(m); else usd += units(raw, decimals.get(m) ?? 0) * p;
  }
  const solPx = price(WSOL) ?? 0;
  return { usd: round(usd + units(TOKEN_ACCOUNT_RENT * BigInt(Math.max(0, rentAccounts)), 9) * solPx), solPx, unpriced };
}
