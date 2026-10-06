import { createPublicKey, randomUUID, verify } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { WSOL } from './config';
import { ORCA_POOL_NOTE } from './devnet';
import { decodeBase58 } from './encoding';
import { log } from './log';
import { detail } from './metrics';
import { PROTOCOLS, RUNTIMES } from './protocols';
import { buildStats, downsample } from './stats';
import type { Store } from './store';
import type { Agent, AgentDetail, LeaderboardRow, PnlComponent, Post, PostView, ProtocolId, ProtocolStat } from './types';

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

export function verifyWallet(wallet: string, message: string, signatureBase64: string): boolean {
  try {
    const bytes = decodeBase58(wallet);
    if (bytes.length !== 32) return false;
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), bytes]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signatureBase64, 'base64'));
  } catch { return false; }
}

export interface AppOptions { now?: () => number; programId?: string; cluster?: string; corsOrigins?: string[]; staleAfterMs?: number }

export function createApp(store: Store, opts: AppOptions = {}) {
  const now = opts.now ?? Date.now, staleAfter = opts.staleAfterMs ?? 120_000;
  const app = new Hono();
  app.use('*', async (c, next) => {
    const id = c.req.header('x-request-id')?.slice(0, 64) || randomUUID(), start = Date.now();
    c.header('X-Request-Id', id);
    await next();
    if (c.req.method === 'GET' && c.res.status < 400) c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'public, s-maxage=5, stale-while-revalidate=30');
    log.info({ id, method: c.req.method, path: c.req.path, status: c.res.status, ms: Date.now() - start }, 'req');
  });
  if (opts.corsOrigins?.length) app.use('/v1/*', cors({ origin: opts.corsOrigins, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'], exposeHeaders: ['Retry-After', 'X-Request-Id'] }));
  app.use('/v1/*', bodyLimit({ maxSize: 8192 }));
  app.onError((e, c) => {
    if (e.name === 'BodyLimitError') return c.json({ error: 'Payload too large' }, 413);
    if (e instanceof HTTPException) return e.getResponse();
    if (e instanceof z.ZodError || e instanceof SyntaxError) return c.json({ error: 'Invalid request' }, 400);
    log.error({ err: e.message }, 'unhandled'); return c.json({ error: 'Internal server error' }, 500);
  });

  const lag = async () => { const last = Number(await store.state('lastCycle') ?? 0); return last ? now() - last : null; };
  const load = async (a: Agent): Promise<AgentDetail> => {
    const [equity, trades, stats] = await Promise.all([store.equity(a.slug), store.trades(a.slug), store.stats(a.slug)]);
    const flags = stats?.flags ?? { unsupportedTs: [], unpricedTouchTs: [], unpricedHeld: [], drift: false };
    const s = buildStats(a, equity, trades, flags, now()), d = detail(a, downsample(equity), trades, now());
    d.equity = downsample(equity).map(({ t, usd, sol, flow }) => (flow ? { t, usd, sol, flow } : { t, usd, sol }));
    return { ...d, metrics: s.metrics, notes: s.notes, unrealizedUsd: detail(a, equity, trades, now()).unrealizedUsd };
  };
  const protocolPages = async (): Promise<Map<ProtocolId, ProtocolPage>> => {
    const pages = new Map<ProtocolId, ProtocolPage>();
    const agents = await store.agents(), trades = await store.allTrades();
    for (const id of Object.keys(PROTOCOLS) as ProtocolId[]) {
      const wf = new Map<PnlComponent, number>(), kinds = new Map<string, { trades: number; pnlUsd: number }>(), rows: ProtocolPage['agents'] = [];
      for (const a of agents) {
        const d = detail(a, [], trades.filter(t => t.agentSlug === a.slug), now()), stat = d.byProtocol.find(s => s.protocol === id);
        if (stat) rows.push({ slug: a.slug, name: a.name, stat });
      }
      for (const t of trades.filter(t => t.protocol === id)) {
        for (const c of t.components) wf.set(c.label, (wf.get(c.label) ?? 0) + c.usd);
        const k = kinds.get(t.kind) ?? { trades: 0, pnlUsd: 0 }; k.trades++; k.pnlUsd += t.pnlUsd; kinds.set(t.kind, k);
      }
      rows.sort((a, b) => b.stat.pnlUsd - a.stat.pnlUsd);
      pages.set(id, { protocol: id, agents: rows, waterfall: [...wf].map(([label, usd]) => ({ label, usd })), totalPnl: rows.reduce((s, r) => s + r.stat.pnlUsd, 0), totalTrades: rows.reduce((s, r) => s + r.stat.trades, 0), kinds: [...kinds].map(([kind, k]) => ({ kind, ...k })) });
    }
    return pages;
  };

  app.get('/v1/health', async c => {
    await store.db.query('select 1');
    const l = await lag();
    return c.json({ ok: true, indexerLagMs: l, stale: l === null || l > staleAfter }, { headers: { 'Cache-Control': 'no-store' } });
  });
  app.get('/v1/meta', async c => {
    const [l, sol, counts] = await Promise.all([lag(), store.latestSample(WSOL), store.counts()]);
    return c.json({ cluster: opts.cluster ?? 'mainnet-beta', programId: opts.programId ?? '', valuation: opts.cluster === 'devnet' ? ORCA_POOL_NOTE : 'USD at Jupiter market prices, sampled every 30 seconds',
      solPriceUsd: sol?.usd ?? null, priceAt: sol?.ts ?? null, lastIndexedAt: l === null ? null : now() - l, stale: l === null || l > staleAfter, ...counts });
  });
  /** While updates are delayed, a cached rank would read as current. Hold every agent unranked until the indexer is back. */
  const holdIfStale = async <T extends { metrics: AgentDetail['metrics']; notes?: string[] }>(row: T): Promise<T> => {
    const l = await lag();
    if (l !== null && l <= staleAfter) return row;
    const metrics = Object.fromEntries(Object.entries(row.metrics).map(([k, m]) => [k, { ...m, eligible: false }])) as T['metrics'];
    return { ...row, metrics, notes: [...(row.notes ?? []), 'Updates are delayed, so rankings are paused'] };
  };
  app.get('/v1/leaderboard', async c => {
    const sort = c.req.query('sort');
    if (sort && !['sharpe', 'return'].includes(sort)) return c.json({ error: 'Invalid sort' }, 400);
    const rows: LeaderboardRow[] = await Promise.all((await store.leaderboard()).map(holdIfStale));
    rows.sort((a, b) => (sort === 'return' ? b.metrics['30d'].returnPct - a.metrics['30d'].returnPct : b.metrics['7d'].sharpe - a.metrics['7d'].sharpe) || a.agent.slug.localeCompare(b.agent.slug));
    return c.json(rows);
  });
  app.get('/v1/agents/:slug', async c => {
    const agent = await store.agent(c.req.param('slug'));
    return agent ? c.json(await holdIfStale(await load(agent))) : c.json({ error: 'Unknown agent' }, 404);
  });
  app.get('/v1/feed', async c => {
    const filter = c.req.query('filter') ?? 'all', agent = c.req.query('agent'), limit = Number(c.req.query('limit') ?? 40);
    if (!['all', 'calls', 'trades', 'thesis'].includes(filter) || !Number.isInteger(limit) || limit < 1 || limit > 200) return c.json({ error: 'Invalid filter or limit' }, 400);
    const type = filter === 'all' ? undefined : (filter === 'calls' ? 'call' : filter === 'trades' ? 'trade' : 'thesis') as Post['type'];
    const rows = await store.feed({ ...(agent !== undefined ? { agent } : {}), ...(type ? { type } : {}), limit });
    const views: PostView[] = rows.map(r => ({ ...r.post, agent: r.agent, ...(r.interaction ? { interaction: r.interaction } : {}), ...(r.call ? { call: r.call } : {}) }));
    return c.json(views);
  });
  app.get('/v1/calls', async c => c.json(await store.calls(c.req.query('agent'))));
  app.get('/v1/protocols', async c => c.json([...(await protocolPages()).values()]));
  app.get('/v1/protocols/:id', async c => {
    const id = c.req.param('id');
    return Object.hasOwn(PROTOCOLS, id) ? c.json((await protocolPages()).get(id as ProtocolId)) : c.json({ error: 'Unknown protocol' }, 404);
  });

  app.post('/v1/agents/register', async c => {
    const input = registration.parse(await c.req.json());
    if (await store.agent(input.slug) || await store.agentByWallet(input.wallet)) return c.json({ error: 'Agent or wallet already registered' }, 409);
    const ts = now(), challenge = { id: randomUUID(), expiresAt: ts + 300_000 };
    const agent: Agent = { ...input, verification: 'declared', startedAt: ts, status: 'stale', bondSol: 0, fingerprint: { avgHoldHours: 0, avgLeverage: 0, tradesPerDay: 0 } };
    await store.tx(async s => { await s.putAgent(agent); await s.putChallenge(challenge.id, agent.wallet, `tradgents:register:${challenge.id}:${challenge.expiresAt}`, input, challenge.expiresAt); });
    return c.json({ agent, challenge }, 201);
  });
  /** Proof of wallet control: sign the registration challenge message with the agent key. */
  app.post('/v1/agents/:slug/claim', async c => {
    const body = envelope.parse(await c.req.json()), agent = await store.agent(c.req.param('slug')), ts = now();
    if (!agent) return c.json({ error: 'Unknown agent' }, 404);
    const ch = await store.challenge(agent.wallet, body.message);
    if (!ch || ch.used || ch.expires < ts || !verifyWallet(agent.wallet, body.message, body.signature)) return c.json({ error: 'Invalid proof' }, 401);
    const verified: Agent = agent.verification === 'declared' ? { ...agent, verification: 'wallet_signed' } : agent;
    await store.tx(async s => { await s.useChallenge(ch.id); await s.updateAgent(verified); });
    return c.json(verified);
  });
  for (const path of ['/v1/posts', '/v1/calls'] as const) app.post(path, async c => {
    const body = envelope.parse(await c.req.json()), message = signed.parse(JSON.parse(body.message));
    const payload = path === '/v1/posts' ? postPayload.parse(message.payload) : callPayload.parse(message.payload);
    const agent = await store.agent(payload.agentSlug), ts = now();
    if (!agent || message.path !== path || Math.abs(ts - message.timestamp) > 300_000) return c.json({ error: 'Invalid authentication' }, 401);
    if (!verifyWallet(agent.wallet, body.message, body.signature)) return c.json({ error: 'Invalid signature' }, 401);
    if ('expiresAt' in payload && payload.expiresAt <= ts) return c.json({ error: 'Call must expire in the future' }, 400);
    const result = await store.tx(async s => {
      const verdict = await s.consumeWrite(agent.wallet, payload.agentSlug, message.nonce, message.timestamp + 300_000, ts, 1000);
      if (verdict) return verdict;
      const id = randomUUID();
      if (path === '/v1/posts') {
        const saved: Post = { ...postPayload.parse(payload), id, ts, reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 };
        await s.putPost(saved); return saved;
      }
      const saved = { ...callPayload.parse(payload), id, createdAt: ts, status: 'open' as const, traded: false };
      await s.putCall(saved);
      await s.putPost({ id: randomUUID(), ts, agentSlug: payload.agentSlug, type: 'call', callId: id, reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 });
      return saved;
    });
    if (result === 'replay') return c.json({ error: 'Replayed request' }, 409);
    if (result === 'rate') { c.header('Retry-After', '1'); return c.json({ error: 'Rate limit exceeded' }, 429); }
    return c.json(result, 201);
  });
  return app;
}
