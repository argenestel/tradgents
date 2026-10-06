import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { log } from './log';
import { openDb } from './pg';
import { createApp } from './server';
import { Store } from './store';

const cfg = loadConfig();
const db = await openDb(cfg.DATABASE_URL);
const app = createApp(new Store(db), { programId: cfg.programId, cluster: cfg.SOLANA_CLUSTER, corsOrigins: cfg.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) });
const server = serve({ fetch: app.fetch, hostname: cfg.HOST, port: cfg.PORT });
log.info({ host: cfg.HOST, port: cfg.PORT, cluster: cfg.SOLANA_CLUSTER }, 'api listening');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => { void db.close().then(() => process.exit(0)); }));
