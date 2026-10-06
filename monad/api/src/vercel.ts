import { handle } from '@hono/node-server/vercel';
import { Hono } from 'hono';
import { waitUntil } from '@vercel/functions';
import pino from 'pino';
import { createApp } from './app.ts';
import { createMonadClient, verifyChainDeployment, verifyUsdcDecimals, verifyWmonMetadata } from './chain.ts';
import { loadConfig } from './config.ts';
import { Indexer } from './indexer.ts';
import { openDb } from './pg.ts';
import { Store } from './store.ts';

/**
 * Vercel mode. A function cannot hold the worker's database session, so indexing runs on a short lease: whenever someone
 * reads the API and the last cycle is old, one invocation takes the lease and runs a cycle in the background.
 */
const config = loadConfig();
const logger = pino({ level: config.logLevel, redact: { paths: ['*.authorization', '*.password', '*.privateKey', '*.secret'], censor: '[REDACTED]' } });
const db = await openDb(config.databaseUrl, { max: 2 });
// Indexing gets its own connection: a long indexing transaction must never block the API's reads.
const tickDb = await openDb(config.databaseUrl, { max: 1 });
const client = createMonadClient(config);
await verifyChainDeployment(client, config);
await verifyUsdcDecimals(client, config.profile.usdc.decimals, config.profile);
await verifyWmonMetadata(client, config.profile);

const TICK_EVERY_MS = 15_000, LEASE_MS = 65_000, MARK_EVERY_MS = 300_000;
let ticking = false;
async function lease(key: string, ttlMs: number): Promise<boolean> {
  const now = Date.now();
  const rows = await tickDb.query(`insert into monad.indexer_state(key,value,updated_ms) values ($1,$2,$3)
    on conflict (key) do update set value=excluded.value, updated_ms=excluded.updated_ms where monad.indexer_state.updated_ms < $4 returning key`, [`lease:${key}`, String(now), now, now - ttlMs]);
  return rows.length > 0;
}
async function tick() {
  if (ticking || process.env.INDEXER === 'off') return;
  ticking = true;
  try {
    const store = new Store(tickDb);
    const last = Number(await store.state('last_tick_ms') ?? 0);
    if (Date.now() - last < TICK_EVERY_MS) return;
    if (!(await lease('tick', LEASE_MS))) { logger.info('tick: lease held elsewhere'); return; }
    logger.info('tick: start');
    // Stop cleanly before the platform kills the function; progress is committed block by block and resumes on the next tick.
    const indexer = new Indexer(tickDb, client, config, logger), now = Date.now(), signal = AbortSignal.timeout(45_000);
    await indexer.samplePrices(now, signal); logger.info('tick: prices sampled');
    try { const r = await indexer.backfill(now, signal); logger.info({ r }, 'tick: backfill done'); } catch (error) { logger.info({ aborted: signal.aborted, msg: error instanceof Error ? error.message.slice(0, 120) : '' }, 'tick: backfill stopped'); if (!signal.aborted) throw error; }
    if (!signal.aborted && now - Number(await store.state('last_mark_ms') ?? 0) >= MARK_EVERY_MS) await indexer.markAll(now, signal);
    await store.setState('last_tick_ms', String(Date.now()));
  } catch (error) { logger.error({ error: error instanceof Error ? error.message : 'unknown' }, 'tick failed'); }
  finally { ticking = false; }
}

// The tick hook has to be registered before the routes it should run for, so the API app is mounted under a parent.
const root = new Hono();
root.use('*', async (c, next) => { if (c.req.method === 'GET') waitUntil(tick()); await next(); });
root.route('/', createApp({ db, config, client, logger }));
export default handle(root);
