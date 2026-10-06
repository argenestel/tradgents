import { createHash } from 'node:crypto';
import { Store } from './db';
import { decodeBase58, encodeBase58 } from './encoding';

const fields = {
  ConfigUpdated: [['admin', 'key'], ['guardian', 'key'], ['treasury', 'key'], ['minimum_bond', 'u64'], ['cooldown', 'i64']],
  AgentRegistered: [['agent_wallet', 'key'], ['beneficiary', 'key'], ['metadata_hash', 'hash'], ['bond', 'u64'], ['unlock_at', 'i64']],
  BondWithdrawn: [['agent_wallet', 'key'], ['bond', 'u64']],
  AgentPaused: [['agent_wallet', 'key'], ['paused', 'bool']],
  AgentSlashed: [['agent_wallet', 'key'], ['bond', 'u64'], ['treasury', 'key']],
} as const;
export type RegistryEvent = { name: string; fields: Record<string, string | boolean> };
/** Anchor's event discriminator is sha256("event:<Rust struct name>")[0..8]. */
export function decodeEvent(encoded: string): RegistryEvent | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Malformed event base64');
  const bytes = Buffer.from(encoded, 'base64');
  for (const [name, schema] of Object.entries(fields)) {
    if (!bytes.subarray(0, 8).equals(createHash('sha256').update(`event:${name}`).digest().subarray(0, 8))) continue;
    let offset = 8;
    const data: RegistryEvent['fields'] = {};
    for (const [key, type] of schema) {
      const size = type === 'bool' ? 1 : type === 'u64' || type === 'i64' ? 8 : 32;
      if (offset + size > bytes.length) throw new Error(`Truncated ${name}`);
      if (type === 'bool') {
        if (bytes[offset] > 1) throw new Error('Invalid Borsh boolean');
        data[key] = bytes[offset] === 1;
      } else if (type === 'key') data[key] = encodeBase58(bytes.subarray(offset, offset + size));
      else if (type === 'hash') data[key] = bytes.subarray(offset, offset + size).toString('hex');
      else data[key] = (type === 'u64' ? bytes.readBigUInt64LE(offset) : bytes.readBigInt64LE(offset)).toString();
      offset += size;
    }
    if (offset !== bytes.length) throw new Error(`Unexpected ${name} event size`);
    return { name, fields: data };
  }
  return undefined;
}
export interface Transaction {
  slot: number;
  meta: { err: unknown; logMessages: string[] | null } | null;
}
export function ingestTransaction(store: Store, programId: string, signature: string, tx: Transaction): number {
  if (!tx.meta) throw new Error(`Missing transaction metadata: ${signature}`);
  if (tx.meta.err) return 0;
  if (!tx.meta.logMessages) throw new Error(`Missing logs: ${signature}`);
  const stack: string[] = [], events: { ix: number; index: number; event: RegistryEvent }[] = [];
  let ix = -1, eventIndex = 0;
  for (const log of tx.meta.logMessages) {
    if (log.includes('Log truncated')) throw new Error(`Truncated logs: ${signature}`);
    const invoke = /^Program (\S+) invoke \[(\d+)\]$/.exec(log);
    if (invoke) {
      if (Number(invoke[2]) === 1) { ix++; eventIndex = 0; }
      stack.push(invoke[1]); continue;
    }
    if (/^Program \S+ (success|failed:)/.test(log)) { stack.pop(); continue; }
    if (stack.at(-1) === programId && log.startsWith('Program data: ')) {
      const event = decodeEvent(log.slice(14));
      if (event) events.push({ ix, index: eventIndex++, event });
    }
  }
  return store.transaction(() => {
    let count = 0;
    for (const e of events) count += Number(store.db.prepare('INSERT INTO registry_events(signature,ix_index,event_index,slot,data) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING')
      .run(signature, e.ix, e.index, tx.slot, JSON.stringify(e.event)).changes);
    return count;
  });
}
type SignatureInfo = { signature: string; slot: number; err: unknown };
export class Indexer {
  constructor(readonly store: Store, readonly rpcUrl: string, readonly programId: string, readonly fetcher: typeof fetch = fetch) {
    if (decodeBase58(programId).length !== 32) throw new Error('PROGRAM_ID must be a 32-byte base58 public key');
    if (!/^https?:/.test(rpcUrl)) throw new Error('RPC_URL must be HTTP(S)');
  }
  async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await this.fetcher(this.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const body = await response.json() as { result?: T; error?: { message: string } };
    if (body.error || body.result === undefined) throw new Error(body.error?.message ?? 'Missing RPC result');
    return body.result;
  }
  /** Fetch every page before advancing the cursor; retries safely replay any committed events. */
  async poll(): Promise<{ transactions: number; events: number }> {
    const stateKey = `head:${this.programId}:${this.rpcUrl}`;
    const head = (this.store.db.prepare('SELECT value FROM indexer_state WHERE key=?').get(stateKey) as { value: string } | undefined)?.value;
    let before: string | undefined, newest: string | undefined, transactions = 0, events = 0;
    const seen = new Set<string>();
    while (true) {
      const page = await this.rpc<SignatureInfo[]>('getSignaturesForAddress', [this.programId, { commitment: 'finalized', limit: 1000, ...(before ? { before } : {}), ...(head ? { until: head } : {}) }]);
      if (!page.length) break;
      newest ??= page[0].signature;
      for (const info of page) {
        if (seen.has(info.signature)) throw new Error('RPC pagination repeated a signature');
        seen.add(info.signature);
        if (!info.err) {
          const tx = await this.rpc<Transaction | null>('getTransaction', [info.signature, { commitment: 'finalized', encoding: 'json', maxSupportedTransactionVersion: 0 }]);
          if (!tx) throw new Error(`Finalized transaction unavailable: ${info.signature}`);
          events += ingestTransaction(this.store, this.programId, info.signature, tx);
        }
        transactions++;
      }
      before = page.at(-1)!.signature;
      if (page.length < 1000) break;
    }
    if (newest) this.store.db.prepare('INSERT INTO indexer_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(stateKey, newest);
    return { transactions, events };
  }
}
