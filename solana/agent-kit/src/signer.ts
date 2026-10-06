import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import fs from 'node:fs';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { z } from 'zod';
import { deriveAta } from './ata';
import { NotSent, type AcctInfo, type Chain } from './chain';
import type { JupiterApi, PriceApi, Quote } from './jupiter';
import { pausePath, STABLE_MINTS, WSOL, type Policy } from './policy';
import type { SpendLedger } from './spend';
import { PROGRAMS, validatePlan, type JupIx, type PlanContext } from './validate';

export type Req = { cmd: string; [k: string]: unknown };
export type Res = { ok: true; result: unknown } | { ok: false; error: string };

const plain = (max: number) => z.string().min(1).max(max).refine(s => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s), 'plain text only');
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const swapArgs = z.object({ cmd: z.enum(['quote', 'swap']), in: z.string().min(1).max(44), out: z.string().min(1).max(44), amount: z.string().regex(/^\d{1,12}(\.\d{1,9})?$/), slippageBps: z.number().int().min(1).optional() }).strict();
const postArgs = z.object({ cmd: z.literal('sign-post'), payload: z.object({ agentSlug: slug, type: z.enum(['thesis', 'milestone']), text: plain(500) }).strict() }).strict();
const callArgs = z.object({ cmd: z.literal('sign-call'), payload: z.object({ agentSlug: slug, market: plain(80), direction: z.enum(['long', 'short']), entry: z.number().positive(), target: z.number().positive(), stop: z.number().positive(), expiresAt: z.number().int().positive(), rationale: plain(500) }).strict() }).strict();
const claimArgs = z.object({ cmd: z.literal('sign-claim'), message: z.string().regex(/^tradgents:register:[0-9a-f-]{36}:\d{13}$/) }).strict();
const bondArgs = z.object({ cmd: z.literal('register-onchain'), slug, name: plain(80), strategy: plain(120), runtime: plain(20), bondSol: z.number().min(0.01) }).strict();

const text = (s: string) => new TextEncoder().encode(s);
/** Exact decimal string to base units, no floating point. */
export function parseUnits(s: string, decimals: number): bigint {
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error(`Too many decimals (this token has ${decimals})`);
  return BigInt(whole + frac.padEnd(decimals, '0'));
}
export const formatUnits = (v: bigint, decimals: number) => { const s = v.toString().padStart(decimals + 1, '0'); const w = s.slice(0, -decimals || undefined), f = decimals ? s.slice(-decimals).replace(/0+$/, '') : ''; return f ? `${w}.${f}` : w; };

export interface SignerDeps { policy: Policy; secret: Uint8Array; chain: Chain; wallet: string; jup: JupiterApi; prices: PriceApi; spend: SpendLedger; now?: () => number }

export class Signer {
  private readonly now: () => number;
  constructor(private readonly d: SignerDeps) { this.now = d.now ?? Date.now; }

  async handle(raw: Req): Promise<Res> {
    try { return { ok: true, result: await this.dispatch(raw) }; }
    catch (e) { return { ok: false, error: e instanceof z.ZodError ? 'Invalid request' : (e as Error).message + (process.env.TRADGENTS_DEBUG ? `\n${(e as Error).stack}` : '') }; }
  }
  private paused() { return fs.existsSync(pausePath(this.d.policy)); }
  private async dispatch(raw: Req): Promise<unknown> {
    switch (raw.cmd) {
      case 'status': return this.status();
      case 'quote': case 'swap': return this.swap(swapArgs.parse(raw));
      case 'sign-post': return this.signApi('/v1/posts', postArgs.parse(raw).payload);
      case 'sign-call': return this.signApi('/v1/calls', callArgs.parse(raw).payload);
      case 'sign-claim': return { signature: this.signBytes(claimArgs.parse(raw).message) };
      case 'register-onchain': return this.registerOnchain(bondArgs.parse(raw));
      default: throw new Error(`Unknown command "${String(raw.cmd)}"`);
    }
  }

  // ---- status
  private async status() {
    const { policy: p, wallet } = this.d;
    const mints = Object.keys(p.allowedMints), atas = await Promise.all(mints.map(m => this.ataOf(wallet, m)));
    const infos = await this.d.chain.accounts([wallet, ...atas]);
    const tokens: Record<string, string> = {};
    mints.forEach((m, i) => { if (m === WSOL) return; const info = infos[i + 1]; tokens[p.allowedMints[m]] = info ? formatUnits(info.data.readBigUInt64LE(64), this.decimalsOf(m)) : '0'; });
    const spent = this.d.spend.spentLast24h();
    return { network: p.network, wallet, sol: formatUnits(infos[0]?.lamports ?? 0n, 9), tokens, paused: this.paused(),
      limits: { maxTradeUsd: p.maxTradeUsd, maxDailyUsd: p.maxDailyUsd, spentLast24hUsd: Number(spent.toFixed(2)), remainingTodayUsd: Number(Math.max(0, p.maxDailyUsd - spent).toFixed(2)), maxSlippageBps: p.maxSlippageBps, allowedTokens: Object.values(p.allowedMints) } };
  }
  private decimalsOf(mint: string) { return mint === WSOL ? 9 : STABLE_MINTS.has(mint) ? 6 : this.extraDecimals.get(mint) ?? 6; }
  private readonly extraDecimals = new Map<string, number>();

  // ---- helpers
  private resolveMint(s: string): string {
    const m = this.d.policy.allowedMints;
    const hit = Object.hasOwn(m, s) ? s : Object.keys(m).find(k => m[k].toLowerCase() === s.toLowerCase());
    if (!hit) throw new Error(`"${s}" is not on this signer's allowed token list (${Object.values(m).join(', ')})`);
    return hit;
  }
  private ataOf(owner: string, mint: string, program: string = PROGRAMS.token) { return deriveAta(owner, mint, program); }
  /** Token program and decimals for every mint involved; SOL and the known stables need no lookup. */
  private async mintInfo(mint: string): Promise<{ program: string; decimals: number }> {
    if (mint === WSOL) return { program: PROGRAMS.token, decimals: 9 };
    const [info] = await this.d.chain.accounts([mint]);
    if (!info) throw new Error(`Mint ${mint} does not exist`);
    if (info.owner !== PROGRAMS.token && info.owner !== PROGRAMS.token2022) throw new Error('Not a token mint');
    if (info.owner === PROGRAMS.token2022 && info.data.length !== 82) throw new Error('Token-2022 mints with extensions (transfer hooks, fees, delegates) are not supported');
    const decimals = info.data[44];
    this.extraDecimals.set(mint, decimals);
    return { program: info.owner, decimals };
  }
  private bytes(): Uint8Array { return this.d.secret; }
  private signBytes(message: string): string {
    const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(this.bytes().subarray(0, 32))]), format: 'der', type: 'pkcs8' });
    return sign(null, Buffer.from(message, 'utf8'), key).toString('base64');
  }
  /** Only domain-separated Tradgents messages are ever signed. The signer will not sign arbitrary bytes. */
  private signApi(path: '/v1/posts' | '/v1/calls', payload: unknown) {
    const message = JSON.stringify({ domain: 'tradgents:v1', path, timestamp: this.now(), nonce: randomUUID(), payload });
    return { message, signature: this.signBytes(message) };
  }

  // ---- swaps
  private async swap(a: z.infer<typeof swapArgs>) {
    const { policy: p, chain, wallet } = this.d, execute = a.cmd === 'swap';
    if (this.paused()) throw new Error('Trading is paused: the PAUSE file exists in the signer state directory');
    const inMint = this.resolveMint(a.in), outMint = this.resolveMint(a.out);
    if (inMint === outMint) throw new Error('Input and output are the same token');
    const slippageBps = a.slippageBps ?? p.maxSlippageBps;
    if (slippageBps > p.maxSlippageBps) throw new Error(`Slippage ${slippageBps} bps is above the limit of ${p.maxSlippageBps}`);
    const [inInfo, outInfo] = await Promise.all([this.mintInfo(inMint), this.mintInfo(outMint)]);
    const amount = parseUnits(a.amount, inInfo.decimals);
    if (amount <= 0n) throw new Error('Amount must be positive');

    // what the input is worth, from a market price the agent cannot influence
    const px = await this.d.prices.usd([inMint, outMint]);
    const pin = px.get(inMint), pout = px.get(outMint);
    if (!pin || (!STABLE_MINTS.has(inMint) && pin.liquidityUsd < p.minLiquidityUsd)) throw new Error('No reliable market price for the input token; refusing to trade');
    if (!pout || (!STABLE_MINTS.has(outMint) && pout.liquidityUsd < p.minLiquidityUsd)) throw new Error('No reliable market price for the output token; refusing to trade');
    const usd = Number(formatUnits(amount, inInfo.decimals)) * pin.usd;
    if (usd > p.maxTradeUsd) throw new Error(`This trade is worth about $${usd.toFixed(2)}, above the per-trade limit of $${p.maxTradeUsd}`);

    const ata: Record<string, string> = { [inMint]: await this.ataOf(wallet, inMint, inInfo.program), [outMint]: await this.ataOf(wallet, outMint, outInfo.program), [WSOL]: await this.ataOf(wallet, WSOL) };
    const wsol = ata[WSOL], src = inMint === WSOL ? wsol : ata[inMint], dst = outMint === WSOL ? wsol : ata[outMint];
    const [wInfo, srcInfo, dstInfo, wsolInfo] = await chain.accounts([wallet, src, dst, wsol]);
    const lamports = wInfo?.lamports ?? 0n;
    if (inMint === WSOL) { if (lamports - amount < BigInt(p.solReserveLamports)) throw new Error(`That would leave less than ${formatUnits(BigInt(p.solReserveLamports), 9)} SOL for fees`); }
    else if (!srcInfo || srcInfo.data.readBigUInt64LE(64) < amount) throw new Error('Not enough of the input token');
    else if (lamports < BigInt(p.solReserveLamports)) throw new Error('SOL balance is below the fee reserve');

    const quote = await this.d.jup.quote({ inputMint: inMint, outputMint: outMint, amount, slippageBps });
    this.checkQuote(quote, { inMint, outMint, amount, slippageBps });
    const outUi = Number(formatUnits(BigInt(quote.outAmount), outInfo.decimals)), outUsd = outUi * pout.usd;
    const floor = usd * (1 - (slippageBps + p.maxPriceImpactBps + p.oracleToleranceBps) / 10_000);
    if (outUsd < floor) throw new Error(`The quote returns about $${outUsd.toFixed(2)} for $${usd.toFixed(2)} of input, worse than the market allows; refusing`);

    const plan = await this.d.jup.plan(quote, wallet, dst, p.maxPriorityLamports);
    const ctx: PlanContext = { wallet, inMint, outMint, amountIn: amount, ata, wsol, maxPriorityLamports: p.maxPriorityLamports, maxTipLamports: p.maxTipLamports, swapProgram: p.network === 'devnet' ? PROGRAMS.orca : PROGRAMS.jupiter };
    const verdict = validatePlan(plan, ctx);
    if (!verdict.ok) throw new Error(`Refusing to sign: ${verdict.reason}`);
    await this.assertNoForeignTokenAccounts(plan.swapInstruction, new Set([src, dst, wsol]));

    const ixs: JupIx[] = [...plan.computeBudgetInstructions, ...plan.setupInstructions, plan.swapInstruction, ...(plan.cleanupInstruction ? [plan.cleanupInstruction] : []), ...plan.otherInstructions];
    const built = await chain.buildSigned(ixs, plan.addressLookupTableAddresses);
    const sim = await chain.simulate(built.wire, [wallet, src, dst, wsol]);
    if (sim.err) throw new Error(`Simulation failed: ${JSON.stringify(sim.err)}`);
    this.checkRoute(sim.logs);
    this.checkSimulation({ inMint, outMint, amount, minOut: BigInt(quote.otherAmountThreshold), pre: [wInfo, srcInfo, dstInfo, wsolInfo], post: sim.accounts, priority: verdict.priorityLamports, tip: verdict.tipLamports });

    const summary = { in: `${a.amount} ${p.allowedMints[inMint]}`, estimatedOut: `${formatUnits(BigInt(quote.outAmount), outInfo.decimals)} ${p.allowedMints[outMint]}`,
      minimumOut: `${formatUnits(BigInt(quote.otherAmountThreshold), outInfo.decimals)} ${p.allowedMints[outMint]}`, valueUsd: Number(usd.toFixed(2)), slippageBps,
      priceImpactPct: quote.priceImpactPct, priorityFeeLamports: verdict.priorityLamports, simulated: true };
    if (!execute) return { ...summary, executed: false };

    // Fees count against the day too: reserve the trade plus the most it can cost in network fees and tips.
    const feeUsd = (verdict.priorityLamports + verdict.tipLamports + 10_000) / 1e9 * (px.get(WSOL)?.usd ?? 0), id = randomUUID();
    const reserved = await this.d.spend.reserve(id, usd + feeUsd, p.maxDailyUsd, p.maxTradesPerDay);
    if (!reserved.ok) throw new Error(reserved.reason === 'count' ? `Trade-count limit: ${p.maxTradesPerDay} trades already in the last 24 hours` : `Daily limit: $${reserved.spent.toFixed(2)} already used of $${p.maxDailyUsd} in the last 24 hours`);
    try {
      await chain.send(built.wire, built.signature);
      this.d.spend.mark(id, 'sent', { signature: built.signature });
    } catch (e) {
      // Only a proven non-landing frees the budget. Anything ambiguous (timeouts, transport errors) stays charged.
      const msg = (e as Error).message;
      if (e instanceof NotSent || /failed on chain/.test(msg)) this.d.spend.mark(id, 'failed', { note: msg.slice(0, 200) });
      else this.d.spend.mark(id, 'sent', { signature: built.signature, note: 'unconfirmed: check the explorer before retrying' });
      throw e;
    }
    return { ...summary, executed: true, signature: built.signature, explorer: `https://solscan.io/tx/${built.signature}${p.network === "devnet" ? "?cluster=devnet" : ""}` };
  }

  private checkQuote(q: Quote, e: { inMint: string; outMint: string; amount: bigint; slippageBps: number }) {
    if (q.inputMint !== e.inMint || q.outputMint !== e.outMint) throw new Error('Quote is for different tokens than requested');
    if (q.swapMode !== 'ExactIn' || BigInt(q.inAmount) !== e.amount) throw new Error('Quote input does not match the request');
    if (q.slippageBps > this.d.policy.maxSlippageBps || q.slippageBps !== e.slippageBps) throw new Error('Quote slippage differs from the request');
    if (q.platformFee) throw new Error('Quote carries a platform fee');
    if (BigInt(q.outAmount) <= 0n || BigInt(q.otherAmountThreshold) <= 0n || BigInt(q.otherAmountThreshold) > BigInt(q.outAmount)) throw new Error('Quote amounts are not sane');
    if (Number(q.priceImpactPct) * 100 > this.d.policy.maxPriceImpactBps) throw new Error(`Price impact ${q.priceImpactPct}% is above the limit`);
  }

  /** The swap may touch only the wallet's own source, destination and wSOL accounts; any other token account it owns must stay out of reach. */
  private async assertNoForeignTokenAccounts(ix: JupIx, allowed: Set<string>) {
    const writable = [...new Set(ix.accounts.filter(a => a.isWritable && !a.isSigner).map(a => a.pubkey))];
    for (let i = 0; i < writable.length; i += 90) {
      const slice = writable.slice(i, i + 90), infos = await this.d.chain.accounts(slice);
      infos.forEach((info, j) => {
        if (!info || (info.owner !== PROGRAMS.token && info.owner !== PROGRAMS.token2022) || info.data.length < 165) return;
        const owner = info.data.subarray(32, 64), me = Buffer.from(getAddressEncoder().encode(address(this.d.wallet)));
        if (owner.equals(me) && !allowed.has(slice[j])) throw new Error(`Refusing to sign: the swap could write to another of the wallet's token accounts (${slice[j]})`);
      });
    }
  }

  /** Every program the simulation ran must be known, if the owner pinned a route list. */
  private checkRoute(logs: string[]) {
    const allowed = this.d.policy.routePrograms;
    if (!allowed) return;
    const ok = new Set<string>([...Object.values(PROGRAMS), ...allowed]);
    for (const l of logs) { const m = /^Program (\S+) invoke \[\d+\]$/.exec(l); if (m && !ok.has(m[1])) throw new Error(`Refusing to sign: the route calls ${m[1]}, which is not on the signer's route list`); }
  }

  /** SOL held as wSOL counts as SOL: wrapping moves it between the two, and a hostile route could spend a pre-existing wSOL balance. */
  private checkSimulation(s: { inMint: string; outMint: string; amount: bigint; minOut: bigint; pre: (AcctInfo | null)[]; post: (AcctInfo | null)[]; priority: number; tip: number }) {
    const bal = (a: AcctInfo | null) => (a && a.data.length >= 72 ? a.data.readBigUInt64LE(64) : 0n); // a closed or missing account holds nothing
    const [wPre, sPre, dPre, wsPre] = s.pre, [wPost, sPost, dPost, wsPost] = s.post;
    const slack = 2n * 2_039_280n + 10_000n + BigInt(s.priority) + BigInt(s.tip);
    if (!wPost || !wPre) throw new Error('Simulation did not return the wallet');
    const solPre = wPre.lamports + bal(wsPre), solPost = wPost.lamports + bal(wsPost);
    if (s.inMint === WSOL) {
      if (solPre - solPost > s.amount + slack) throw new Error('Simulation shows more SOL leaving the wallet than the trade amount');
    } else {
      if (bal(sPre) - bal(sPost) > s.amount) throw new Error('Simulation shows more of the input token leaving than the trade amount');
      if (s.outMint !== WSOL && solPre - solPost > slack) throw new Error('Simulation shows SOL leaving the wallet beyond fees and rent');
    }
    if (s.outMint === WSOL) {
      if (solPost - solPre + slack < s.minOut) throw new Error('Simulation shows less SOL arriving than the quote guarantees');
    } else if (bal(dPost) - bal(dPre) < s.minOut) throw new Error('Simulation shows less output than the quote guarantees');
  }

  // ---- on-chain registration (the bond)
  private async registerOnchain(a: z.infer<typeof bondArgs>) {
    const { policy: p, chain, wallet } = this.d;
    if (!p.registryProgram) throw new Error('This signer has no registry program configured');
    if (a.bondSol > p.maxBondSol) throw new Error(`Bond ${a.bondSol} SOL is above this signer's limit of ${p.maxBondSol}`);
    const program = address(p.registryProgram), enc = getAddressEncoder();
    const [config] = await getProgramDerivedAddress({ programAddress: program, seeds: [text('config')] });
    const [agent] = await getProgramDerivedAddress({ programAddress: program, seeds: [text('agent'), enc.encode(address(wallet))] });
    const [vault] = await getProgramDerivedAddress({ programAddress: program, seeds: [text('vault'), enc.encode(agent)] });
    const hash = createHash('sha256').update(JSON.stringify([a.slug, a.name, a.strategy, a.runtime, wallet])).digest();
    const data = Buffer.alloc(48); Buffer.from([135, 157, 66, 195, 2, 113, 175, 30]).copy(data); hash.copy(data, 8); data.writeBigUInt64LE(BigInt(Math.round(a.bondSol * 1e9)), 40);
    const ix: JupIx = { programId: p.registryProgram, data: data.toString('base64'), accounts: [
      { pubkey: wallet, isSigner: true, isWritable: true }, { pubkey: wallet, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false }, { pubkey: agent, isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: PROGRAMS.system, isSigner: false, isWritable: false }] };
    if (this.paused()) throw new Error('Trading is paused');
    // A bond is money leaving the wallet: it counts against the same per-trade and daily limits.
    const sol = (await this.d.prices.usd([WSOL])).get(WSOL);
    if (!sol) throw new Error('No reliable SOL price; refusing to post a bond');
    const bondUsd = a.bondSol * sol.usd;
    if (bondUsd > p.maxTradeUsd) throw new Error(`The bond is worth about $${bondUsd.toFixed(2)}, above the per-trade limit of $${p.maxTradeUsd}`);
    const bondId = randomUUID(), held = await this.d.spend.reserve(bondId, bondUsd, p.maxDailyUsd, p.maxTradesPerDay);
    if (!held.ok) throw new Error('The bond does not fit in today\'s limits');
    const built = await chain.buildSigned([ix], []);
    const sim = await chain.simulate(built.wire, [wallet]);
    if (sim.err) { this.d.spend.mark(bondId, 'failed', { note: 'simulation failed' }); throw new Error(`Simulation failed: ${JSON.stringify(sim.err)}`); }
    try { await chain.send(built.wire, built.signature); this.d.spend.mark(bondId, 'sent', { signature: built.signature }); }
    catch (e) { if (e instanceof NotSent) this.d.spend.mark(bondId, 'failed', { note: 'not sent' }); else this.d.spend.mark(bondId, 'sent', { signature: built.signature, note: 'unconfirmed' }); throw e; }
    return { signature: built.signature, bondSol: a.bondSol };
  }
}
