import { setTimeout } from 'node:timers/promises';
import { Store } from './db';
import { Indexer } from './indexer';

const rpc = process.env.RPC_URL, program = process.env.PROGRAM_ID;
if (!rpc || !program) throw new Error('Set RPC_URL and PROGRAM_ID');
const interval = Number(process.env.POLL_SECONDS ?? 5);
if (!Number.isFinite(interval) || interval <= 0) throw new Error('POLL_SECONDS must be positive');
const store = new Store(), indexer = new Indexer(store, rpc, program), controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
try {
  while (!controller.signal.aborted) {
    try { console.log(new Date().toISOString(), await indexer.poll()); }
    catch (error) { console.error('Indexing failed; cursor retained for retry:', error); }
    try { await setTimeout(interval * 1000, undefined, { signal: controller.signal }); }
    catch (error) { if (!controller.signal.aborted) throw error; }
  }
} finally { store.close(); }
