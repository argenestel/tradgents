import { handle } from '@hono/node-server/vercel';
import { waitUntil } from '@vercel/functions';
import { loadConfig } from './config';
import { OrcaDevnetPrices } from './devnet';
import { log } from './log';
import { openDb } from './pg';
import { JupiterPrices } from './prices';
import { Rpc } from './rpc';
import { createApp } from './server';
import { Store } from './store';
import { createWorker } from './worker';

/**
 * Vercel mode. A function cannot hold the worker's database session, so indexing runs on a short lease:
 * whenever someone reads the API and the last cycle is older than TICK_EVERY_MS, one invocation takes the lease and
 * runs a cycle in the background. The API itself uses the restricted role; the tick uses WORKER_DATABASE_URL.
 */
const cfg = loadConfig();
const TICK_EVERY_MS = 15_000, LEASE_MS = 55_000;
const apiStore = new Store(await openDb(cfg.DATABASE_URL, { max: 1 }));
const workerUrl = process.env.WORKER_DATABASE_URL;
let ticking = false;

async function tick() {
  if (!workerUrl || ticking || cfg.INDEXER === 'off') return;
  ticking = true;
  try {
    const last = Number(await apiStore.state('lastCycle') ?? 0);
    if (Date.now() - last < TICK_EVERY_MS) return;
    const db = await openDb(workerUrl, { max: 1 }), store = new Store(db);
    try {
      if (!(await store.acquireLease('tick', LEASE_MS, Date.now()))) return;
      const rpc = new Rpc(cfg.rpcUrl);
      const prices = cfg.SOLANA_CLUSTER === 'devnet' ? new OrcaDevnetPrices(rpc)
        : new JupiterPrices({ minLiquidityUsd: cfg.MIN_LIQUIDITY_USD, ...(cfg.JUPITER_API_KEY ? { apiKey: cfg.JUPITER_API_KEY } : {}) });
      await createWorker({ store, rpc, prices, cfg }).cycle();
    } finally { await db.close(); }
  } catch (e) { log.error({ err: (e as Error).message }, 'tick failed'); }
  finally { ticking = false; }
}

const app = createApp(apiStore, { programId: cfg.programId, cluster: cfg.SOLANA_CLUSTER, corsOrigins: cfg.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean),
  onRead: () => waitUntil(tick()) });
export default handle(app);
