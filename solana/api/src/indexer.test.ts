import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Store } from './db';
import { decodeBase58, encodeBase58 } from './encoding';
import { decodeEvent, Indexer, ingestTransaction, type Transaction } from './indexer';

const program = 'Fg6PaFpoGXkYsidMpWxTWqkZq6W2BeZ7FEfcYkgMQHG';
const wallet = Buffer.alloc(32, 7), pubkey = encodeBase58(wallet);
const discriminator = (name: string) => createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const event = (name: string, ...fields: Buffer[]) => Buffer.concat([discriminator(name), ...fields]).toString('base64');
const registered = event('AgentRegistered', wallet, wallet, Buffer.alloc(32, 1), u64(9007199254740993n), u64(100n));
const tx = (logs = [`Program ${program} invoke [1]`, `Program data: ${registered}`, `Program ${program} success`]): Transaction => ({ slot: 42, meta: { err: null, logMessages: logs } });
let store: Store;
beforeEach(() => { store = new Store(':memory:'); });
afterEach(() => store.close());
it('round trips base58 including leading zeros', () => { for (const bytes of [Buffer.alloc(32), wallet, Buffer.from([0, 0, 1, 255])]) expect(decodeBase58(encodeBase58(bytes))).toEqual(bytes); expect(() => decodeBase58('0')).toThrow(); });
it('decodes registered event preserving u64 precision', () => { expect(decodeEvent(registered)).toEqual({ name: 'AgentRegistered', fields: { agent_wallet: pubkey, beneficiary: pubkey, metadata_hash: '01'.repeat(32), bond: '9007199254740993', unlock_at: '100' } }); });
it('decodes every registry event and signed cooldown', () => {
  const cooldown = Buffer.alloc(8); cooldown.writeBigInt64LE(-1n);
  expect(decodeEvent(event('ConfigUpdated', wallet, wallet, wallet, u64(5n), cooldown))?.fields.cooldown).toBe('-1');
  expect(decodeEvent(event('BondWithdrawn', wallet, u64(5n)))?.fields.bond).toBe('5');
  expect(decodeEvent(event('AgentPaused', wallet, Buffer.from([1])))?.fields.paused).toBe(true);
  expect(decodeEvent(event('AgentSlashed', wallet, u64(5n), wallet))?.fields.treasury).toBe(pubkey);
});
it('rejects malformed known events and ignores unknown discriminators', () => { expect(() => decodeEvent(event('AgentPaused', wallet))).toThrow('Truncated'); expect(() => decodeEvent(event('AgentPaused', wallet, Buffer.from([2])))).toThrow(); expect(() => decodeEvent('%%%')).toThrow(); expect(decodeEvent(Buffer.alloc(8).toString('base64'))).toBeUndefined(); });
it('ingests idempotently with no demo rows or chain metrics', () => {
  expect(ingestTransaction(store, program, 'sig', tx())).toBe(1); expect(ingestTransaction(store, program, 'sig', tx())).toBe(0);
  expect(store.db.prepare('SELECT slot,ix_index,event_index FROM registry_events').get()).toMatchObject({ slot: 42, ix_index: 0, event_index: 0 });
  expect(store.agents()).toEqual([]); expect(store.db.prepare('SELECT * FROM equity').all()).toEqual([]);
});
it('attributes nested CPI events only to the active registry program', () => {
  const logs = ['Program other invoke [1]', `Program ${program} invoke [2]`, `Program data: ${registered}`,
    'Program spoof invoke [3]', `Program data: ${registered}`, 'Program spoof success', `Program data: ${registered}`,
    `Program ${program} success`, `Program data: ${registered}`, 'Program other success', `Program ${program} invoke [1]`, `Program data: ${registered}`, `Program ${program} success`];
  expect(ingestTransaction(store, program, 'sig', tx(logs))).toBe(3);
  expect(store.db.prepare('SELECT ix_index,event_index FROM registry_events ORDER BY ix_index,event_index').all()).toEqual([{ ix_index: 0, event_index: 0 }, { ix_index: 0, event_index: 1 }, { ix_index: 1, event_index: 0 }]);
});
it('does not ingest failed transactions', () => { expect(ingestTransaction(store, program, 'sig', { slot: 42, meta: { err: { InstructionError: [0, 'error'] }, logMessages: tx().meta!.logMessages } })).toBe(0); });
it('rejects missing and truncated logs for retry', () => {
  expect(() => ingestTransaction(store, program, 'sig', { slot: 42, meta: null })).toThrow();
  expect(() => ingestTransaction(store, program, 'sig', { slot: 42, meta: { err: null, logMessages: null } })).toThrow();
  expect(() => ingestTransaction(store, program, 'sig', tx(['Log truncated']))).toThrow();
});
function rpcMock(handler: (method: string, params: any[]) => unknown) {
  return vi.fn(async (_url: any, init: any) => { const req = JSON.parse(init.body); return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: handler(req.method, req.params) }), { status: 200 }); }) as unknown as typeof fetch;
}
it('polls finalized and reuses persistent restart cursor', async () => {
  let fresh = true;
  const fetcher = rpcMock((method, params) => {
    expect(params[1].commitment).toBe('finalized');
    if (method === 'getSignaturesForAddress') { if (!fresh) expect(params[1].until).toBe('sig'); return fresh ? [{ signature: 'sig', slot: 42, err: null }] : []; }
    expect(params[1]).toMatchObject({ encoding: 'json', maxSupportedTransactionVersion: 0 }); return tx();
  });
  expect(await new Indexer(store, 'http://rpc.test', program, fetcher).poll()).toEqual({ transactions: 1, events: 1 });
  fresh = false;
  expect(await new Indexer(store, 'http://rpc.test', program, fetcher).poll()).toEqual({ transactions: 0, events: 0 });
});
it('backfills all pages and skips failed transactions', async () => {
  const page = Array.from({ length: 1000 }, (_, i) => ({ signature: `sig-${i}`, slot: 42, err: i === 0 ? null : 'failed' }));
  const fetcher = rpcMock((method, params) => method === 'getTransaction' ? tx() : params[1].before ? [{ signature: 'old', slot: 41, err: 'failed' }] : page);
  expect(await new Indexer(store, 'http://rpc.test', program, fetcher).poll()).toEqual({ transactions: 1001, events: 1 });
});
it('retains cursor on unavailable transaction and idempotently retries', async () => {
  let available = false;
  const fetcher = rpcMock((method, params) => method === 'getSignaturesForAddress' ? [{ signature: 'a', err: null }, { signature: 'b', err: null }] : params[0] === 'b' && !available ? null : tx());
  const indexer = new Indexer(store, 'http://rpc.test', program, fetcher);
  await expect(indexer.poll()).rejects.toThrow('unavailable');
  expect(store.db.prepare('SELECT * FROM indexer_state').all()).toEqual([]);
  available = true;
  expect(await indexer.poll()).toEqual({ transactions: 2, events: 1 });
  expect(store.db.prepare('SELECT * FROM registry_events').all()).toHaveLength(2);
});
it('rejects RPC errors without advancing cursor', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'RPC unavailable' } }))) as unknown as typeof fetch;
  await expect(new Indexer(store, 'http://rpc.test', program, fetcher).poll()).rejects.toThrow('RPC unavailable');
  expect(store.db.prepare('SELECT * FROM indexer_state').all()).toEqual([]);
});
