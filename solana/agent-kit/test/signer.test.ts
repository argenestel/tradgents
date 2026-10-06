import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveAta } from '../src/ata';
import type { AcctInfo, Chain } from '../src/chain';
import { listen, request } from '../src/ipc';
import type { JupiterApi, PriceApi, Quote } from '../src/jupiter';
import { loadPolicy, policySchema, USDC, USDT, WSOL, type Policy } from '../src/policy';
import { formatUnits, parseUnits, Signer } from '../src/signer';
import { SpendLedger } from '../src/spend';
import { PROGRAMS, type JupIx, type SwapPlan } from '../src/validate';

const W = 'EET2cUX1nrFcQ12vBuyFsXfNACmSm1gs93jCsFiLvsSk';
const secret = new Uint8Array(64); secret.fill(7, 0, 32);
const acc = (pubkey: string, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const tokenAcct = (owner: string, amount: bigint): AcctInfo => { const d = Buffer.alloc(165); void owner; d.writeBigUInt64LE(amount, 64); return { lamports: 2_039_280n, owner: PROGRAMS.token, data: d }; };
const mintAcct = (decimals: number): AcctInfo => { const d = Buffer.alloc(82); d[44] = decimals; return { lamports: 1n, owner: PROGRAMS.token, data: d }; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const ix = (programId: string, data: Buffer, accounts: JupIx['accounts'] = []): JupIx => ({ programId, data: data.toString('base64'), accounts });

let dir: string, policy: Policy, state: { lamports: bigint; usdc: bigint; sims: number; sent: string[]; simErr: unknown; postLamports?: bigint; postUsdc?: bigint; tokenOwners: Map<string, AcctInfo> };
let usdcAta: string, wsolAta: string, quote: Quote, plan: SwapPlan, price: { sol: number; usdc: number };
let signer: Signer, spend: SpendLedger, clock: number;

const chain = (): Chain => ({
  genesis: async () => 'g',
  async accounts(addrs) {
    return addrs.map(a => a === W ? { lamports: state.lamports, owner: PROGRAMS.system, data: Buffer.alloc(0) } : a === USDC || a === USDT ? mintAcct(6) : a === usdcAta ? tokenAcct(W, state.usdc) : a === wsolAta ? null : state.tokenOwners.get(a) ?? null);
  },
  buildSigned: async () => ({ wire: 'wire', signature: 'SIG' + state.sent.length }),
  async simulate() {
    state.sims++;
    return { err: state.simErr, logs: [], accounts: [{ lamports: state.postLamports ?? state.lamports - 100_000_000n - 20_000n, owner: PROGRAMS.system, data: Buffer.alloc(0) }, null, tokenAcct(W, state.postUsdc ?? state.usdc + 12_124_969n)] };
  },
  async send(_w, sig) { state.sent.push(sig); },
});
const jup = (): JupiterApi => ({ quote: async () => quote, plan: async () => plan });
const prices = (): PriceApi => ({ usd: async mints => new Map(mints.map(m => [m, m === WSOL ? { usd: price.sol, liquidityUsd: 1e9 } : { usd: price.usdc, liquidityUsd: Infinity }])) });
const swap = (over: object = {}) => signer.handle({ cmd: 'swap', in: 'SOL', out: 'USDC', amount: '0.1', ...over });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signer-')); clock = 1_800_000_000_000;
  policy = policySchema.parse({ network: 'mainnet-beta', rpcUrl: 'http://rpc', keypairPath: path.join(dir, 'k.json'), stateDir: dir, socketPath: path.join(dir, 's.sock'), apiUrl: 'http://api', maxTradeUsd: 20, maxDailyUsd: 30, registryProgram: PROGRAMS.system });
  usdcAta = await deriveAta(W, USDC); wsolAta = await deriveAta(W, WSOL);
  state = { lamports: 5_000_000_000n, usdc: 50_000_000n, sims: 0, sent: [], simErr: null, tokenOwners: new Map() };
  price = { sol: 120, usdc: 1 };
  quote = { inputMint: WSOL, inAmount: '100000000', outputMint: USDC, outAmount: '12185898', otherAmountThreshold: '12124969', swapMode: 'ExactIn', slippageBps: 100, priceImpactPct: '0', routePlan: [], platformFee: null };
  plan = {
    computeBudgetInstructions: [ix(PROGRAMS.compute, Buffer.concat([Buffer.from([2]), u32(200_000)])), ix(PROGRAMS.compute, Buffer.concat([Buffer.from([3]), u64(100_000n)]))],
    setupInstructions: [
      ix(PROGRAMS.ata, Buffer.from([1]), [acc(W, true, true), acc(usdcAta, false, true), acc(W), acc(USDC)]), ix(PROGRAMS.ata, Buffer.from([1]), [acc(W, true, true), acc(wsolAta, false, true), acc(W), acc(WSOL)]),
      ix(PROGRAMS.system, Buffer.concat([u32(2), u64(100_000_000n)]), [acc(W, true, true), acc(wsolAta, false, true)]), ix(PROGRAMS.token, Buffer.from([17]), [acc(wsolAta, false, true)])],
    swapInstruction: ix(PROGRAMS.jupiter, Buffer.from([1]), [acc(W, true), acc(wsolAta, false, true), acc(usdcAta, false, true), acc('Pool1111111111111111111111111111111111111', false, true)]),
    cleanupInstruction: ix(PROGRAMS.token, Buffer.from([9]), [acc(wsolAta, false, true), acc(W, false, true), acc(W, true)]), otherInstructions: [], addressLookupTableAddresses: [],
  };
  spend = new SpendLedger(path.join(dir, 'ledger'), () => clock);
  signer = new Signer({ policy, secret, chain: chain(), wallet: W, jup: jup(), prices: prices(), spend, now: () => clock });
});
const fail = async (p: Promise<{ ok: boolean; error?: string }>, re: RegExp) => { const r = await p; expect(r.ok).toBe(false); expect(r.error).toMatch(re); };

describe('swap', () => {
  it('quote validates and simulates but sends and spends nothing', async () => {
    const r = await swap({ cmd: 'quote' }) as { ok: true; result: Record<string, unknown> };
    expect(r.ok).toBe(true); expect(r.result).toMatchObject({ executed: false, simulated: true, valueUsd: 12, estimatedOut: '12.185898 USDC', minimumOut: '12.124969 USDC' });
    expect(state.sent).toEqual([]); expect(spend.spentLast24h()).toBe(0);
  });
  it('swap sends once, reserves the USD value, and reports the signature', async () => {
    const r = await swap() as { ok: true; result: Record<string, unknown> };
    expect(r.result).toMatchObject({ executed: true, signature: 'SIG0' }); expect(state.sent).toEqual(['SIG0']); expect(spend.spentLast24h()).toBeCloseTo(12, 6);
  });
  it('enforces the per-trade limit, the daily limit (rolling 24h) and frees it a day later', async () => {
    await fail(swap({ amount: '0.2' }), /per-trade limit/);
    await swap(); await swap();                                   // 12 + 12 = 24 of 30
    await fail(swap(), /Daily limit/); expect(state.sent).toHaveLength(2);
    clock += 25 * 3600_000; expect((await swap()).ok).toBe(true);
  });
  it('a failed send frees its budget; an unconfirmed one keeps it', async () => {
    const c = chain(); c.send = async () => { throw new Error('Transaction failed on chain: {}'); };
    signer = new Signer({ policy, secret, chain: c, wallet: W, jup: jup(), prices: prices(), spend, now: () => clock });
    await fail(swap(), /failed on chain/); expect(spend.spentLast24h()).toBe(0);
    c.send = async () => { throw new Error('Transaction X was not confirmed in time'); };
    await fail(swap(), /not confirmed/); expect(spend.spentLast24h()).toBeCloseTo(12, 6);
  });
  it('refuses tokens outside the allowlist, same-token swaps, and too much slippage', async () => {
    await fail(swap({ out: 'BONK' }), /allowed token list/); await fail(swap({ out: 'SOL' }), /same token/); await fail(swap({ slippageBps: 101 }), /above the limit/);
  });
  it('refuses when the quote is worse than the market allows (oracle check, not the aggregator\'s own number)', async () => {
    quote.outAmount = '9000000'; quote.otherAmountThreshold = '8900000';
    await fail(swap(), /worse than the market allows/);
  });
  it('refuses when no reliable price exists', async () => {
    signer = new Signer({ policy, secret, chain: chain(), wallet: W, jup: jup(), prices: { usd: async () => new Map() }, spend, now: () => clock });
    await fail(swap(), /No reliable market price/);
  });
  it('refuses quotes that do not match the request', async () => {
    quote.inAmount = '100000001'; await fail(swap(), /input does not match/);
    quote.inAmount = '100000000'; quote.priceImpactPct = '5'; await fail(swap(), /Price impact/);
    quote.priceImpactPct = '0'; quote.platformFee = { amount: '1' }; await fail(swap(), /platform fee/);
    quote.platformFee = null; quote.outputMint = USDT; await fail(swap(), /different tokens/);
  });
  it('refuses a hostile plan and does not build or send it', async () => {
    plan.setupInstructions.push(ix(PROGRAMS.token, Buffer.concat([Buffer.from([4]), u64(2n ** 64n - 1n)]), [acc(usdcAta, false, true), acc('Attacker1111111111111111111111111111111111'), acc(W, true)]));
    await fail(swap(), /Refusing to sign/); expect(state.sims).toBe(0); expect(state.sent).toEqual([]);
  });
  it('refuses a swap that could write to another token account of the wallet', async () => {
    const other = 'OtherTokenAcct1111111111111111111111111111';
    state.tokenOwners.set(other, tokenAcct(W, 1n)); const info = state.tokenOwners.get(other)!;
    // owner bytes of the wallet at offset 32 (the signer compares them with the wallet's public key)
    const { getAddressEncoder, address } = await import('@solana/kit'); Buffer.from(getAddressEncoder().encode(address(W))).copy(info.data, 32);
    plan.swapInstruction.accounts.push(acc(other, false, true));
    await fail(swap(), /another of the wallet's token accounts/);
  });
  it('refuses when simulation fails or shows more leaving than the trade amount', async () => {
    state.simErr = 'InsufficientFunds'; await fail(swap(), /Simulation failed/);
    state.simErr = null; state.postLamports = state.lamports - 2_000_000_000n; await fail(swap(), /more SOL leaving/);
    state.postLamports = undefined; state.postUsdc = state.usdc + 1n; await fail(swap(), /less output than the quote/);
  });
  it('keeps the SOL fee reserve and checks token balances', async () => {
    state.lamports = 110_000_000n; await fail(swap(), /less than 0.02 SOL/);
    state.lamports = 5_000_000_000n; state.usdc = 1n; await fail(swap({ in: 'USDC', out: 'SOL', amount: '5' }), /Not enough of the input token/);
  });
  it('stops everything when the PAUSE file exists', async () => {
    fs.writeFileSync(path.join(dir, 'PAUSE'), ''); await fail(swap(), /paused/); expect(state.sent).toEqual([]);
  });
});

describe('other commands', () => {
  it('reports status and remaining limits', async () => {
    await swap();
    const r = await signer.handle({ cmd: 'status' }) as { ok: true; result: { sol: string; tokens: Record<string, string>; limits: { remainingTodayUsd: number } } };
    expect(r.result).toMatchObject({ sol: '5', tokens: { USDC: '50' } }); expect(r.result.limits.remainingTodayUsd).toBe(18);
  });
  it('signs only well-formed Tradgents messages, and the signature verifies', async () => {
    const r = await signer.handle({ cmd: 'sign-post', payload: { agentSlug: 'a', type: 'thesis', text: 'hello' } }) as { ok: true; result: { message: string; signature: string } };
    expect(JSON.parse(r.result.message)).toMatchObject({ domain: 'tradgents:v1', path: '/v1/posts', payload: { text: 'hello' } }); expect(r.result.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    const pub = createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(secret.subarray(0, 32))]), format: 'der', type: 'pkcs8' }));
    expect(verify(null, Buffer.from(r.result.message), pub, Buffer.from(r.result.signature, 'base64'))).toBe(true); // exactly what the API checks
    await fail(signer.handle({ cmd: 'sign-post', payload: { agentSlug: 'a', type: 'thesis', text: '<script>' } }), /Invalid request/);
    await fail(signer.handle({ cmd: 'sign-claim', message: 'send all my funds' }), /Invalid request/);
    await fail(signer.handle({ cmd: 'sign-bytes', message: 'anything' }), /Unknown command/);
    expect((await signer.handle({ cmd: 'sign-claim', message: 'tradgents:register:12345678-1234-1234-1234-123456789012:1800000000000' })).ok).toBe(true);
  });
  it('registers on chain within the bond limit only', async () => {
    const args = { cmd: 'register-onchain', slug: 'a', name: 'A', strategy: 's', runtime: 'codex' };
    await fail(signer.handle({ ...args, bondSol: 5 }), /above this signer's limit/);
    expect(await signer.handle({ ...args, bondSol: 0.1 })).toMatchObject({ ok: true, result: { bondSol: 0.1 } });
  });
});

describe('spend ledger', () => {
  it('serializes concurrent reservations so two cannot both fit', async () => {
    const l = new SpendLedger(path.join(dir, 'l2'), () => clock);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => l.reserve(`id${i}`, 10, 35)));
    expect(results.filter(r => r.ok)).toHaveLength(3);
  });
  it('survives restart', async () => { await new SpendLedger(path.join(dir, 'l3'), () => clock).reserve('x', 7, 10); expect(new SpendLedger(path.join(dir, 'l3'), () => clock).spentLast24h()).toBe(7); });
});

describe('policy file', () => {
  const base = () => ({ network: 'mainnet-beta', rpcUrl: 'http://rpc', keypairPath: path.join(dir, 'k.json'), stateDir: dir, socketPath: path.join(dir, 's'), apiUrl: 'http://api', maxTradeUsd: 5, maxDailyUsd: 10 });
  it('loads a private policy and refuses ones others can edit, or keys others can read', () => {
    fs.writeFileSync(path.join(dir, 'k.json'), '[]', { mode: 0o600 }); const f = path.join(dir, 'p.json'); fs.writeFileSync(f, JSON.stringify(base()), { mode: 0o600 });
    expect(loadPolicy(f).maxTradeUsd).toBe(5);
    fs.chmodSync(f, 0o666); expect(() => loadPolicy(f)).toThrow(/writable by group or others/);
    fs.chmodSync(f, 0o600); fs.chmodSync(path.join(dir, 'k.json'), 0o644); expect(() => loadPolicy(f)).toThrow(/readable only by its owner/);
  });
  it('rejects unknown fields, a trade limit above the daily limit, and non-mainnet networks', () => {
    expect(() => policySchema.parse({ ...base(), extra: 1 })).toThrow(); expect(() => policySchema.parse({ ...base(), maxTradeUsd: 11 })).toThrow(); expect(() => policySchema.parse({ ...base(), network: 'devnet' })).toThrow();
  });
});

describe('units and ipc', () => {
  it('parses and formats exact decimals', () => {
    expect(parseUnits('0.1', 9)).toBe(100_000_000n); expect(parseUnits('12', 6)).toBe(12_000_000n); expect(() => parseUnits('0.1234567', 6)).toThrow(/decimals/);
    expect(formatUnits(12_185_898n, 6)).toBe('12.185898'); expect(formatUnits(5_000_000_000n, 9)).toBe('5'); expect(formatUnits(0n, 6)).toBe('0');
  });
  it('round-trips over a real unix socket with the socket restricted to its owner', async () => {
    const sock = path.join(dir, 'ipc.sock');
    const server = await listen(sock, '600', req => signer.handle(req));
    expect(fs.statSync(sock).mode & 0o777).toBe(0o600);
    expect(await request(sock, { cmd: 'status' })).toMatchObject({ ok: true });
    expect(await request(sock, { cmd: 'nope' })).toEqual({ ok: false, error: 'Unknown command "nope"' });
    await new Promise<void>(r => server.close(() => r()));
  });
});
