import { describe, expect, it } from 'vitest';
import { PROGRAMS, TIP_ACCOUNTS, priorityOf, validatePlan, type JupIx, type PlanContext, type SwapPlan } from '../src/validate';

const W = 'EET2cUX1nrFcQ12vBuyFsXfNACmSm1gs93jCsFiLvsSk', OTHER = 'Other11111111111111111111111111111111111111';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', SOL = 'So11111111111111111111111111111111111111112';
const WSOL_ATA = 'WsolAta1111111111111111111111111111111111', USDC_ATA = 'UsdcAta1111111111111111111111111111111111';
const ctx: PlanContext = { wallet: W, inMint: SOL, outMint: USDC, amountIn: 100_000_000n, ata: { [USDC]: USDC_ATA, [SOL]: WSOL_ATA }, wsol: WSOL_ATA, maxPriorityLamports: 100_000, maxTipLamports: 0 };
const acc = (pubkey: string, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
const b64 = (...bytes: number[]) => Buffer.from(bytes).toString('base64');
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const ix = (programId: string, data: Buffer, accounts = [] as JupIx['accounts']): JupIx => ({ programId, data: data.toString('base64'), accounts });
const limit = ix(PROGRAMS.compute, Buffer.concat([Buffer.from([2]), u32(200_000)])), price = ix(PROGRAMS.compute, Buffer.concat([Buffer.from([3]), u64(100_000n)])); // 20,000 lamports
const good = (): SwapPlan => ({
  computeBudgetInstructions: [limit, price],
  setupInstructions: [
    ix(PROGRAMS.ata, Buffer.from([1]), [acc(W, true, true), acc(USDC_ATA, false, true), acc(W), acc(USDC), acc(PROGRAMS.system), acc(PROGRAMS.token)]),
    ix(PROGRAMS.ata, Buffer.from([1]), [acc(W, true, true), acc(WSOL_ATA, false, true), acc(W), acc(SOL), acc(PROGRAMS.system), acc(PROGRAMS.token)]),
    ix(PROGRAMS.system, Buffer.concat([u32(2), u64(100_000_000n)]), [acc(W, true, true), acc(WSOL_ATA, false, true)]),
    ix(PROGRAMS.token, Buffer.from([17]), [acc(WSOL_ATA, false, true)]),
  ],
  swapInstruction: ix(PROGRAMS.jupiter, Buffer.from([1, 2, 3]), [acc(PROGRAMS.token), acc(W, true), acc(WSOL_ATA, false, true), acc(USDC_ATA, false, true), acc('SomePool111111111111111111111111111111111', false, true)]),
  cleanupInstruction: ix(PROGRAMS.token, Buffer.from([9]), [acc(WSOL_ATA, false, true), acc(W, false, true), acc(W, true)]),
  otherInstructions: [], addressLookupTableAddresses: ['Alt11111111111111111111111111111111111111'],
});
const reject = (mut: (p: SwapPlan) => void, re: RegExp, c = ctx) => { const p = good(); mut(p); const v = validatePlan(p, c); expect(v.ok).toBe(false); if (!v.ok) expect(v.reason).toMatch(re); };

describe('validatePlan', () => {
  it('accepts the shape Jupiter really returns for SOL to USDC', () => { expect(validatePlan(good(), ctx)).toEqual({ ok: true, priorityLamports: 20_000, tipLamports: 0 }); });
  it('accepts a USDC to SOL plan with no wrap', () => {
    const p = good(); p.setupInstructions = p.setupInstructions.slice(0, 2);
    p.swapInstruction = ix(PROGRAMS.jupiter, Buffer.from([1]), [acc(W, true), acc(USDC_ATA, false, true), acc(WSOL_ATA, false, true)]);
    expect(validatePlan(p, { ...ctx, inMint: USDC, outMint: SOL, amountIn: 5_000_000n }).ok).toBe(true);
  });
  it('rejects instructions from programs outside the allowlist', () => reject(p => p.setupInstructions.push(ix(OTHER, Buffer.from([0]))), /setup instruction uses program/));
  it('rejects SOL sent anywhere but the wallet\'s own wSOL account', () => reject(p => { p.setupInstructions[2] = ix(PROGRAMS.system, Buffer.concat([u32(2), u64(1n)]), [acc(W, true, true), acc(OTHER, false, true)]); }, /own wSOL/));
  it('rejects a wrap larger than the trade', () => reject(p => { p.setupInstructions[2] = ix(PROGRAMS.system, Buffer.concat([u32(2), u64(100_000_001n)]), [acc(W, true, true), acc(WSOL_ATA, false, true)]); }, /exceeds/));
  it('rejects system instructions other than transfer', () => reject(p => { p.setupInstructions[2] = ix(PROGRAMS.system, Buffer.concat([u32(0), u64(1n)]), [acc(W, true, true)]); }, /unsupported system/));
  it('rejects token accounts created for or paid by someone else', () => {
    reject(p => { p.setupInstructions[0] = ix(PROGRAMS.ata, Buffer.from([1]), [acc(W, true, true), acc(USDC_ATA, false, true), acc(OTHER), acc(USDC)]); }, /someone else/);
    reject(p => { p.setupInstructions[0] = ix(PROGRAMS.ata, Buffer.from([1]), [acc(OTHER, true, true), acc(USDC_ATA, false, true), acc(W), acc(USDC)]); }, /signature from someone else/);
  });
  it('rejects approvals and authority changes smuggled into setup', () => {
    reject(p => p.setupInstructions.push(ix(PROGRAMS.token, Buffer.concat([Buffer.from([4]), u64(2n ** 64n - 1n)]), [acc(USDC_ATA, false, true), acc(OTHER), acc(W, true)])), /unsupported token instruction/);
    reject(p => p.setupInstructions.push(ix(PROGRAMS.token, Buffer.from([6, 0, 0]), [acc(USDC_ATA, false, true), acc(W, true)])), /unsupported token instruction/);
  });
  it('rejects a swap that is not Jupiter, needs another signer, or skips the wallet\'s accounts', () => {
    reject(p => { p.swapInstruction.programId = OTHER; }, /not the Jupiter program/);
    reject(p => p.swapInstruction.accounts.push(acc(OTHER, true)), /signature from someone else/);
    reject(p => { p.swapInstruction.accounts = p.swapInstruction.accounts.filter(a => a.pubkey !== USDC_ATA); }, /destination accounts/);
  });
  it('rejects a cleanup that closes into another account or closes the wrong account', () => {
    reject(p => { p.cleanupInstruction = ix(PROGRAMS.token, Buffer.from([9]), [acc(WSOL_ATA, false, true), acc(OTHER, false, true), acc(W, true)]); }, /cleanup/);
    reject(p => { p.cleanupInstruction = ix(PROGRAMS.token, Buffer.from([9]), [acc(USDC_ATA, false, true), acc(W, false, true), acc(W, true)]); }, /cleanup/);
  });
  it('enforces the priority-fee cap and rejects heap requests and unknown compute instructions', () => {
    reject(() => undefined, /priority fee/, { ...ctx, maxPriorityLamports: 19_999 });
    reject(p => { p.computeBudgetInstructions = [ix(PROGRAMS.compute, Buffer.concat([Buffer.from([1]), u32(262144)]))]; }, /unsupported compute/);
    reject(p => { p.computeBudgetInstructions = [ix(OTHER, Buffer.from([2]))]; }, /non compute-budget/);
  });
  it('allows a capped Jito tip and rejects anything else in other instructions', () => {
    const tip = ix(PROGRAMS.system, Buffer.concat([u32(2), u64(5_000n)]), [acc(W, true, true), acc([...TIP_ACCOUNTS][0], false, true)]);
    const p = good(); p.otherInstructions = [tip];
    expect(validatePlan(p, { ...ctx, maxTipLamports: 10_000 })).toMatchObject({ ok: true, tipLamports: 5000 });
    expect(validatePlan(p, ctx).ok).toBe(false);
    reject(q => { q.otherInstructions = [ix(PROGRAMS.system, Buffer.concat([u32(2), u64(5n)]), [acc(W, true, true), acc(OTHER, false, true)])]; }, /extra instruction/, { ...ctx, maxTipLamports: 10_000 });
  });
  it('rejects a token-ledger instruction', () => reject(p => { p.tokenLedgerInstruction = ix(PROGRAMS.jupiter, Buffer.from([0])); }, /token-ledger/));
  it('prices compute: limit times unit price, rounded up', () => { expect(priorityOf([limit, price])).toEqual({ lamports: 20_000 }); expect(priorityOf([])).toEqual({ lamports: 0 }); void b64; });
});
