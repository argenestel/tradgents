import { loadConfig } from './config';
import { OrcaDevnetPrices } from './devnet';
import { log } from './log';
import { openDb } from './pg';
import { JupiterPrices } from './prices';
import { Rpc } from './rpc';
import { Store } from './store';
import { createWorker, WORKER_LOCK } from './worker';

const cfg = loadConfig();
if (!process.env.DATABASE_URL_DIRECT) throw new Error('The worker needs DATABASE_URL_DIRECT: its single-instance lock must live on a session-mode connection');
const db = await openDb(process.env.DATABASE_URL_DIRECT, { max: 4 });
const rpc = new Rpc(cfg.rpcUrl);
const prices = cfg.SOLANA_CLUSTER === 'devnet' ? new OrcaDevnetPrices(rpc)
  : new JupiterPrices({ minLiquidityUsd: cfg.MIN_LIQUIDITY_USD, ...(cfg.JUPITER_API_KEY ? { apiKey: cfg.JUPITER_API_KEY } : {}), ...(cfg.JUPITER_PRICE_URL ? { baseUrl: cfg.JUPITER_PRICE_URL } : {}) });
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
const ran = await db.withAdvisoryLock(WORKER_LOCK, async lost => {
  lost.addEventListener('abort', () => { log.error('lost the database session that holds the worker lock; exiting'); controller.abort(); process.exitCode = 1; });
  log.info({ cluster: cfg.SOLANA_CLUSTER }, 'worker started');
  await createWorker({ store: new Store(db), rpc, prices, cfg }).run(controller.signal);
  return true;
});
if (!ran) log.warn('another worker holds the lock; exiting');
await db.close();
