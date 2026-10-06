/** Everything here is pure: the signer calls it on whatever the aggregator returned, before anything is signed. */
export const PROGRAMS = {
  system: '11111111111111111111111111111111',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  compute: 'ComputeBudget111111111111111111111111111111',
  jupiter: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
} as const;
export const TIP_ACCOUNTS = new Set([
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5', 'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe', 'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49', 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh', 'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL', '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
]);

export interface JupIx { programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }
export interface SwapPlan {
  tokenLedgerInstruction?: JupIx | null;
  computeBudgetInstructions: JupIx[];
  setupInstructions: JupIx[];
  swapInstruction: JupIx;
  cleanupInstruction?: JupIx | null;
  otherInstructions: JupIx[];
  addressLookupTableAddresses: string[];
}
export interface PlanContext {
  wallet: string; inMint: string; outMint: string; amountIn: bigint;
  /** Derived token accounts of the wallet for each mint involved (the wSOL account is always listed). */
  ata: Record<string, string>; wsol: string;
  maxPriorityLamports: number; maxTipLamports: number; unitLimitFallback?: number;
}
export type Verdict = { ok: true; priorityLamports: number; tipLamports: number } | { ok: false; reason: string };
const no = (reason: string): Verdict => ({ ok: false, reason });
const bytes = (d: string) => Buffer.from(d, 'base64');

/** Compute-unit price x limit, in lamports. Rejects heap requests and anything unknown. */
export function priorityOf(ixs: JupIx[], fallbackLimit = 1_400_000): { lamports: number } | { error: string } {
  let price = 0n, limit = BigInt(fallbackLimit);
  for (const ix of ixs) {
    if (ix.programId !== PROGRAMS.compute) return { error: 'non compute-budget instruction in the compute budget list' };
    const d = bytes(ix.data);
    if (d[0] === 2 && d.length === 5) limit = BigInt(d.readUInt32LE(1));
    else if (d[0] === 3 && d.length === 9) price = d.readBigUInt64LE(1);
    else if (d[0] === 4 && d.length === 5) continue; // loaded accounts data size limit
    else return { error: `unsupported compute budget instruction ${d[0]}` };
  }
  return { lamports: Number((price * limit + 999_999n) / 1_000_000n) };
}

/** Allowlist check of the aggregator's instructions. Anything not explained here is refused. */
export function validatePlan(plan: SwapPlan, c: PlanContext): Verdict {
  if (plan.tokenLedgerInstruction) return no('unexpected token-ledger instruction');
  const prio = priorityOf(plan.computeBudgetInstructions, c.unitLimitFallback);
  if ('error' in prio) return no(prio.error);
  if (prio.lamports > c.maxPriorityLamports) return no(`priority fee ${prio.lamports} lamports is above the cap of ${c.maxPriorityLamports}`);
  const owned = new Set(Object.values(c.ata).concat(c.wsol));
  const wrapTargets = new Set([c.wsol]);

  for (const ix of plan.setupInstructions) {
    const d = bytes(ix.data), a = ix.accounts.map(x => x.pubkey);
    if (ix.accounts.some(x => x.isSigner && x.pubkey !== c.wallet)) return no('setup instruction needs a signature from someone else');
    if (ix.programId === PROGRAMS.ata) {
      // [payer, ata, owner, mint, system, token]; create or create-idempotent, owner and payer must be the agent wallet
      if (!(d.length === 0 || (d.length === 1 && (d[0] === 0 || d[0] === 1)))) return no('unsupported associated-token instruction');
      if (a[0] !== c.wallet || a[2] !== c.wallet) return no('token account would be created for or paid by someone else');
      if (!owned.has(a[1])) return no(`token account ${a[1]} is not one of the wallet's own accounts`);
    } else if (ix.programId === PROGRAMS.system) {
      // only: transfer SOL from the wallet into its own wSOL account, no more than the trade amount
      if (d.length !== 12 || d.readUInt32LE(0) !== 2) return no('unsupported system instruction in setup');
      if (a[0] !== c.wallet || !wrapTargets.has(a[1])) return no('SOL would be sent somewhere other than the wallet\'s own wSOL account');
      if (d.readBigUInt64LE(4) > c.amountIn) return no('wrap amount exceeds the trade amount');
    } else if (ix.programId === PROGRAMS.token) {
      if (!(d.length === 1 && d[0] === 17) || !wrapTargets.has(a[0])) return no('unsupported token instruction in setup (only SyncNative on the wallet\'s own wSOL account)');
    } else return no(`setup instruction uses program ${ix.programId}`);
  }

  const sw = plan.swapInstruction;
  if (sw.programId !== PROGRAMS.jupiter) return no('swap instruction is not the Jupiter program');
  if (sw.accounts.some(x => x.isSigner && x.pubkey !== c.wallet)) return no('swap needs a signature from someone else');
  const keys = new Set(sw.accounts.map(x => x.pubkey));
  const src = c.inMint === 'So11111111111111111111111111111111111111112' ? c.wsol : c.ata[c.inMint];
  const dst = c.outMint === 'So11111111111111111111111111111111111111112' ? c.wsol : c.ata[c.outMint];
  if (!keys.has(src) || !keys.has(dst)) return no('swap does not use the wallet\'s own source and destination accounts');

  const cl = plan.cleanupInstruction;
  if (cl) {
    const d = bytes(cl.data), a = cl.accounts.map(x => x.pubkey);
    // only CloseAccount of the wallet's own wSOL account back to the wallet
    if (cl.programId !== PROGRAMS.token || d.length !== 1 || d[0] !== 9 || a[0] !== c.wsol || a[1] !== c.wallet || a[2] !== c.wallet) return no('unsupported cleanup instruction');
  }
  let tip = 0;
  for (const ix of plan.otherInstructions) {
    const d = bytes(ix.data), a = ix.accounts.map(x => x.pubkey);
    if (ix.programId === PROGRAMS.system && d.length === 12 && d.readUInt32LE(0) === 2 && a[0] === c.wallet && TIP_ACCOUNTS.has(a[1])) tip += Number(d.readBigUInt64LE(4));
    else return no('unexpected extra instruction');
  }
  if (tip > c.maxTipLamports) return no(`tip ${tip} lamports is above the cap of ${c.maxTipLamports}`);
  return { ok: true, priorityLamports: prio.lamports, tipLamports: tip };
}

/** SPL token account layout: mint(32) owner(32) amount(u64). Token-2022 accounts begin the same way. */
export function parseTokenAccount(data: Buffer): { mint: string; owner: string; amount: bigint } | undefined {
  if (data.length < 72) return undefined;
  return { mint: data.subarray(0, 32).toString('hex'), owner: data.subarray(32, 64).toString('hex'), amount: data.readBigUInt64LE(64) };
}
