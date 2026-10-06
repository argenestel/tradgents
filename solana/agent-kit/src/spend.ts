import fs from 'node:fs';
import path from 'node:path';

export interface SpendEntry { id: string; ts: number; usd: number; status: 'reserved' | 'sent' | 'failed'; signature?: string; note?: string }
const DAY = 86_400_000;

/**
 * Append-only spend ledger kept in the signer's own state directory. A trade is reserved BEFORE it is sent and counts
 * against the daily limit until it is marked failed, so a crash mid-send fails closed (the budget stays spent).
 */
export class SpendLedger {
  private readonly file: string;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(dir: string, private readonly now: () => number = Date.now) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'spend.jsonl');
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '', { mode: 0o600 });
  }
  private read(): SpendEntry[] {
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as SpendEntry);
  }
  private append(e: SpendEntry) { fs.appendFileSync(this.file, JSON.stringify(e) + '\n'); fs.fsyncSync(fs.openSync(this.file, 'r')); }
  /** Latest state per id, so a later `failed` line cancels an earlier `reserved` one. */
  private latest(): SpendEntry[] { const m = new Map<string, SpendEntry>(); for (const e of this.read()) m.set(e.id, { ...m.get(e.id), ...e }); return [...m.values()]; }
  spentLast24h(): number { const since = this.now() - DAY; return this.latest().filter(e => e.status !== 'failed' && e.ts > since).reduce((s, e) => s + e.usd, 0); }
  /** Serialized so two concurrent intents cannot both pass the check. */
  reserve(id: string, usd: number, limit: number): Promise<{ ok: true } | { ok: false; spent: number }> {
    const run = this.chain.then(() => {
      const spent = this.spentLast24h();
      if (spent + usd > limit + 1e-9) return { ok: false as const, spent };
      this.append({ id, ts: this.now(), usd, status: 'reserved' });
      return { ok: true as const };
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
  mark(id: string, status: 'sent' | 'failed', extra: { signature?: string; note?: string } = {}) {
    const prior = this.latest().find(e => e.id === id);
    if (!prior) throw new Error(`Unknown spend id ${id}`);
    this.append({ ...prior, status, ...extra });
  }
}
