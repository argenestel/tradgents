import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDb } from './pg';
import { migrate } from './migrate';
import { Rpc } from './rpc';
import { Store } from './store';
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
beforeEach(async () => { const db = await openDb('memory:'); await migrate(db); store = new Store(db); });
afterEach(() => store.db.close());
const count = async (t: string) => (await store.db.query<{ n: number }>(`select count(*)::int as n from solana.${t}`))[0].n;
it('ingests idempotently', async () => {
  expect(await ingestTransaction(store, program, 'sig', tx())).toBe(1); expect(await ingestTransaction(store, program, 'sig', tx())).toBe(0);
  expect(await store.db.query('select slot::int as slot, ix_index, event_index from solana.registry_events')).toEqual([{ slot: 42, ix_index: 0, event_index: 0 }]);
  expect(await store.agents()).toEqual([]); expect(await count('equity')).toBe(0);
});
it('attributes nested CPI events only to the active registry program', async () => {
  const logs = ['Program other invoke [1]', `Program ${program} invoke [2]`, `Program data: ${registered}`,
    'Program spoof invoke [3]', `Program data: ${registered}`, 'Program spoof success', `Program data: ${registered}`,
    `Program ${program} success`, `Program data: ${registered}`, 'Program other success', `Program ${program} invoke [1]`, `Program data: ${registered}`, `Program ${program} success`];
  expect(await ingestTransaction(store, program, 'sig', tx(logs))).toBe(3);
  expect(await store.db.query('select ix_index, event_index from solana.registry_events order by ix_index, event_index')).toEqual([{ ix_index: 0, event_index: 0 }, { ix_index: 0, event_index: 1 }, { ix_index: 1, event_index: 0 }]);
});
it('does not ingest failed transactions', async () => { expect(await ingestTransaction(store, program, 'sig', { slot: 42, meta: { err: { InstructionError: [0, 'error'] }, logMessages: tx().meta!.logMessages } })).toBe(0); });
it('rejects missing and truncated logs for retry', async () => {
  await expect(ingestTransaction(store, program, 'sig', { slot: 42, meta: null })).rejects.toThrow();
  await expect(ingestTransaction(store, program, 'sig', { slot: 42, meta: { err: null, logMessages: null } })).rejects.toThrow();
  await expect(ingestTransaction(store, program, 'sig', tx(['Log truncated']))).rejects.toThrow();
});
function rpcMock(handler: (method: string, params: any[]) => unknown) {
  const fetcher = vi.fn(async (_url: any, init: any) => { const req = JSON.parse(init.body); return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: handler(req.method, req.params) }), { status: 200 }); }) as unknown as typeof fetch;
  return new Rpc('http://rpc.test', fetcher);
}
it('polls finalized and reuses persistent restart cursor', async () => {
  let fresh = true;
  const rpc = rpcMock((method, params) => {
    expect(params[1].commitment).toBe('finalized');
    if (method === 'getSignaturesForAddress') { if (!fresh) expect(params[1].until).toBe('sig'); return fresh ? [{ signature: 'sig', slot: 42, err: null }] : []; }
    expect(params[1]).toMatchObject({ encoding: 'json' }); return tx();
  });
  expect(await new Indexer(store, rpc, program).poll()).toEqual({ transactions: 1, events: 1 });
  fresh = false;
  expect(await new Indexer(store, rpc, program).poll()).toEqual({ transactions: 0, events: 0 });
});
it('backfills all pages and skips failed transactions', async () => {
  const page = Array.from({ length: 1000 }, (_, i) => ({ signature: `sig-${i}`, slot: 42, err: i === 0 ? null : 'failed' }));
  const rpc = rpcMock((method, params) => method === 'getTransaction' ? tx() : params[1].before ? [{ signature: 'old', slot: 41, err: 'failed' }] : page);
  expect(await new Indexer(store, rpc, program).poll()).toEqual({ transactions: 1001, events: 1 });
});
it('retains cursor on unavailable transaction and idempotently retries', async () => {
  let available = false;
  const rpc = rpcMock((method, params) => method === 'getSignaturesForAddress' ? [{ signature: 'a', err: null }, { signature: 'b', err: null }] : params[0] === 'b' && !available ? null : tx());
  const indexer = new Indexer(store, rpc, program);
  await expect(indexer.poll()).rejects.toThrow('unavailable');
  expect(await count('indexer_state')).toBe(0);
  available = true;
  expect(await indexer.poll()).toEqual({ transactions: 2, events: 1 });
  expect(await count('registry_events')).toBe(2);
});
it('rejects RPC errors without advancing cursor', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'RPC unavailable' } }))) as unknown as typeof fetch;
  await expect(new Indexer(store, new Rpc('http://rpc.test', fetcher), program).poll()).rejects.toThrow('RPC unavailable');
  expect(await count('indexer_state')).toBe(0);
});
