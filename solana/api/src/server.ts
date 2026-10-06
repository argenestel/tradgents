import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { Store } from './db';
import { decodeBase58 } from './encoding';
import { detail, type Valuation } from './metrics';
import { PROTOCOLS, RUNTIMES } from './protocols';
import type { Agent, AgentDetail, Call, Interaction, LeaderboardRow, PnlComponent, Post, PostView, ProtocolId, ProtocolStat } from './types';

export interface ProtocolPage {
  protocol: ProtocolId;
  agents: { slug: string; name: string; stat: ProtocolStat }[];
  waterfall: { label: PnlComponent; usd: number }[];
  totalPnl: number;
  totalTrades: number;
  kinds: { kind: string; trades: number; pnlUsd: number }[];
}
const plain = (max: number) => z.string().min(1).max(max).refine(s => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(s), 'Plain text required');
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);
const registration = z.object({
  slug, wallet: z.string().min(32).max(44).refine(s => { try { return decodeBase58(s).length === 32; } catch { return false; } }),
  name: plain(80), bio: plain(500), runtime: z.enum(Object.keys(RUNTIMES) as [keyof typeof RUNTIMES, ...Array<keyof typeof RUNTIMES>]),
  strategyLabel: plain(120), protocols: z.array(z.enum(Object.keys(PROTOCOLS) as [ProtocolId, ...ProtocolId[]])).max(8),
  startCapitalUsd: z.number().finite().nonnegative().default(0),
}).strict();
const postPayload = z.object({ agentSlug: slug, type: z.enum(['thesis', 'milestone']), text: plain(500) }).strict();
const callPayload = z.object({ agentSlug: slug, market: plain(80), direction: z.enum(['long', 'short']),
  entry: z.number().finite().positive(), target: z.number().finite().positive(), stop: z.number().finite().positive(),
  expiresAt: z.number().int().positive(), rationale: plain(500),
}).strict();
const envelope = z.object({ message: z.string().max(4096), signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/) }).strict();
const signed = z.object({ domain: z.literal('tradgents:v1'), path: z.enum(['/v1/posts', '/v1/calls']),
  timestamp: z.number().int(), nonce: z.string().min(16).max(128), payload: z.unknown(),
}).strict();

export function createApp(store: Store, now: () => number = Date.now) {
  const app = new Hono();
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (origins.length) app.use('/v1/*', cors({ origin: origins, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'], exposeHeaders: ['X-Demo-Data', 'Retry-After'] }));
  app.use('/v1/*', bodyLimit({ maxSize: 8192 }));
  app.onError((e, c) => {
    if (e.name === 'BodyLimitError') return c.json({ error: 'Payload too large' }, 413);
    if (e instanceof HTTPException) return e.getResponse();
    if (e instanceof z.ZodError || e instanceof SyntaxError) return c.json({ error: 'Invalid request' }, 400);
    console.error(e); return c.json({ error: 'Internal server error' }, 500);
  });
  const load = (a: Agent): AgentDetail => {
    const equity = store.db.prepare('SELECT data,flow FROM equity WHERE agent=? ORDER BY ts').all(a.slug) as { data: string; flow: number }[];
    return detail(a, equity.map(r => ({ ...JSON.parse(r.data), flow: r.flow } as Valuation)),
      store.rows<Interaction>('SELECT data,demo FROM trades WHERE agent=? ORDER BY ts DESC', a.slug).map(r => r.data), now());
  };
  const protocolPage = (id: ProtocolId): ProtocolPage => {
    const agents: ProtocolPage['agents'] = [], waterfall = new Map<PnlComponent, number>(), kinds = new Map<string, { trades: number; pnlUsd: number }>();
    for (const row of store.agents()) {
      const d = load(row.data), stat = d.byProtocol.find(s => s.protocol === id);
      if (stat) agents.push({ slug: d.agent.slug, name: d.agent.name, stat });
      for (const i of d.interactions.filter(i => i.protocol === id)) {
        for (const c of i.components) waterfall.set(c.label, (waterfall.get(c.label) ?? 0) + c.usd);
        const k = kinds.get(i.kind) ?? { trades: 0, pnlUsd: 0 }; k.trades++; k.pnlUsd += i.pnlUsd; kinds.set(i.kind, k);
      }
    }
    agents.sort((a, b) => b.stat.pnlUsd - a.stat.pnlUsd);
    return { protocol: id, agents, waterfall: [...waterfall].map(([label, usd]) => ({ label, usd })),
      totalPnl: agents.reduce((s, a) => s + a.stat.pnlUsd, 0), totalTrades: agents.reduce((s, a) => s + a.stat.trades, 0),
      kinds: [...kinds].map(([kind, k]) => ({ kind, ...k })) };
  };
  app.get('/v1/health', c => { store.db.prepare('SELECT 1').get(); return c.json({ ok: true }); });
  app.get('/v1/leaderboard', c => {
    const rows = store.agents();
    if (rows.some(r => r.demo) || store.rows('SELECT data,demo FROM equity UNION ALL SELECT data,demo FROM trades').some(r => r.demo)) c.header('X-Demo-Data', 'true');
    const result: LeaderboardRow[] = rows.map(r => { const d = load(r.data), pts = d.equity.slice(-30); return {
      agent: d.agent, equityUsd: d.equityUsd, tier: d.tier, metrics: d.metrics,
      spark: pts.map(p => pts[0].usd > 0 ? p.usd / pts[0].usd * 100 : 100),
    }; });
    const sort = c.req.query('sort');
    if (sort && !['sharpe', 'return'].includes(sort)) return c.json({ error: 'Invalid sort' }, 400);
    result.sort((a, b) => (sort === 'return' ? b.metrics['30d'].returnPct - a.metrics['30d'].returnPct : b.metrics['7d'].sharpe - a.metrics['7d'].sharpe) || a.agent.slug.localeCompare(b.agent.slug));
    return c.json(result);
  });
  app.get('/v1/agents/:slug', c => {
    const row = store.agent(c.req.param('slug'));
    if (!row) return c.json({ error: 'Unknown agent' }, 404);
    if (row.demo || store.rows('SELECT data,demo FROM equity WHERE agent=? UNION ALL SELECT data,demo FROM trades WHERE agent=?', row.data.slug, row.data.slug).some(r => r.demo)) c.header('X-Demo-Data', 'true');
    return c.json(load(row.data));
  });
  app.get('/v1/feed', c => {
    const filter = c.req.query('filter') ?? 'all', agent = c.req.query('agent'), limit = Number(c.req.query('limit') ?? 40);
    if (!['all', 'calls', 'trades', 'thesis'].includes(filter) || !Number.isInteger(limit) || limit < 1 || limit > 200) return c.json({ error: 'Invalid filter or limit' }, 400);
    const conditions: string[] = [], args: (string | number)[] = [];
    if (agent !== undefined) { conditions.push('agent=?'); args.push(agent); }
    if (filter !== 'all') { conditions.push("json_extract(data,'$.type')=?"); args.push(filter === 'calls' ? 'call' : filter === 'trades' ? 'trade' : 'thesis'); }
    args.push(limit);
    const rows = store.rows<Post>(`SELECT data,demo FROM posts ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY ts DESC,id DESC LIMIT ?`, ...args);
    const views: PostView[] = rows.map(r => {
      const a = store.agent(r.data.agentSlug)!;
      const interaction = r.data.interactionId ? store.rows<Interaction>('SELECT data,demo FROM trades WHERE id=?', r.data.interactionId)[0] : undefined;
      const call = r.data.callId ? store.rows<Call>('SELECT data,demo FROM calls WHERE id=?', r.data.callId)[0] : undefined;
      if (r.demo || a.demo || interaction?.demo || call?.demo) c.header('X-Demo-Data', 'true');
      return { ...r.data, agent: a.data, ...(interaction ? { interaction: interaction.data } : {}), ...(call ? { call: call.data } : {}) };
    });
    return c.json(views);
  });
  app.get('/v1/calls', c => {
    const agent = c.req.query('agent');
    const rows = store.rows<Call>(`SELECT data,demo FROM calls ${agent !== undefined ? 'WHERE agent=?' : ''} ORDER BY ts DESC,id DESC`, ...(agent !== undefined ? [agent] : []));
    if (rows.some(r => r.demo)) c.header('X-Demo-Data', 'true');
    return c.json(rows.map(r => r.data));
  });
  app.get('/v1/protocols', c => {
    if (store.rows('SELECT data,demo FROM trades').some(r => r.demo)) c.header('X-Demo-Data', 'true');
    return c.json((Object.keys(PROTOCOLS) as ProtocolId[]).map(protocolPage));
  });
  app.get('/v1/protocols/:id', c => {
    const id = c.req.param('id');
    if (!Object.hasOwn(PROTOCOLS, id)) return c.json({ error: 'Unknown protocol' }, 404);
    if (store.rows<Interaction>('SELECT data,demo FROM trades').some(r => r.demo && r.data.protocol === id)) c.header('X-Demo-Data', 'true');
    return c.json(protocolPage(id as ProtocolId));
  });
  app.post('/v1/agents/register', async c => {
    const input = registration.parse(await c.req.json());
    if (store.agent(input.slug) || store.wallet(input.wallet)) return c.json({ error: 'Agent or wallet already registered' }, 409);
    const ts = now(), challenge = { id: randomUUID(), expiresAt: ts + 300_000 };
    const agent: Agent = { ...input, verification: 'declared', startedAt: ts, status: 'stale', bondSol: 0,
      fingerprint: { avgHoldHours: 0, avgLeverage: 0, tradesPerDay: 0 } };
    store.transaction(() => {
      store.putAgent(agent, false);
      store.db.prepare('INSERT INTO challenges(id,wallet,message,metadata,expires) VALUES(?,?,?,?,?)').run(challenge.id, agent.wallet,
        `tradgents:register:${challenge.id}:${challenge.expiresAt}`, JSON.stringify(input), challenge.expiresAt);
    });
    return c.json({ agent, challenge }, 201);
  });
  for (const path of ['/v1/posts', '/v1/calls'] as const) app.post(path, async c => {
    const body = envelope.parse(await c.req.json()), message = signed.parse(JSON.parse(body.message));
    const payload = path === '/v1/posts' ? postPayload.parse(message.payload) : callPayload.parse(message.payload);
    const row = store.agent(payload.agentSlug), ts = now();
    if (!row || message.path !== path || Math.abs(ts - message.timestamp) > 300_000) return c.json({ error: 'Invalid authentication' }, 401);
    let valid = false;
    try {
      const bytes = decodeBase58(row.data.wallet);
      if (bytes.length === 32) {
        const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes]), format: 'der', type: 'spki' });
        valid = verify(null, Buffer.from(body.message, 'utf8'), key, Buffer.from(body.signature, 'base64'));
      }
    } catch { /* Invalid legacy/demo wallet bytes are an authentication failure. */ }
    if (!valid) return c.json({ error: 'Invalid signature' }, 401);
    if ('expiresAt' in payload && payload.expiresAt <= ts) return c.json({ error: 'Call must expire in the future' }, 400);
    const result = store.transaction(() => {
      store.db.prepare('DELETE FROM nonces WHERE expires<?').run(ts);
      if (store.db.prepare('SELECT 1 FROM nonces WHERE wallet=? AND nonce=?').get(row.data.wallet, message.nonce)) return 'replay';
      const quota = store.db.prepare("SELECT last FROM quotas WHERE principal=? AND kind='write'").get(payload.agentSlug) as { last: number } | undefined;
      if (quota && ts - quota.last < 1000) return 'rate';
      const id = randomUUID();
      let saved: Post | Call;
      if (path === '/v1/posts') {
        const p = postPayload.parse(payload);
        saved = { ...p, id, ts, reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 };
        store.putPost(saved, false);
      } else {
        saved = { ...callPayload.parse(payload), id, createdAt: ts, status: 'open', traded: false };
        store.putCall(saved, false);
        store.putPost({ id: randomUUID(), ts, agentSlug: payload.agentSlug, type: 'call', callId: id, reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 }, false);
      }
      store.db.prepare('INSERT INTO nonces VALUES(?,?,?)').run(row.data.wallet, message.nonce, message.timestamp + 300_000);
      store.db.prepare("INSERT INTO quotas VALUES(?,'write',?) ON CONFLICT(principal,kind) DO UPDATE SET last=excluded.last").run(payload.agentSlug, ts);
      return saved;
    });
    if (result === 'replay') return c.json({ error: 'Replayed request' }, 409);
    if (result === 'rate') { c.header('Retry-After', '1'); return c.json({ error: 'Rate limit exceeded' }, 429); }
    return c.json(result, 201);
  });
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new Store();
  const server = serve({ fetch: createApp(store).fetch, hostname: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 8787) });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
