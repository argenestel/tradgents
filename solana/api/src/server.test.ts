import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from './db';
import { encodeBase58 } from './encoding';
import { MOCK_NOW } from './format';
import { seedDemo } from './seed';
import { createApp, type ProtocolPage } from './server';
import type { AgentDetail, Call, LeaderboardRow, PostView } from './types';

// Fixed test-only Ed25519 seed; no wallet files or key generation.
const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]), format: 'der', type: 'pkcs8' });
const wallet = encodeBase58(createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32));
let store: Store, app: ReturnType<typeof createApp>, time: number;
beforeEach(() => { store = new Store(':memory:'); time = MOCK_NOW; app = createApp(store, () => time); });
afterEach(() => store.close());
const register = () => app.request('/v1/agents/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'test-agent', wallet, name: 'Test', bio: 'A test', runtime: 'codex', strategyLabel: 'Test strategy', protocols: ['jupiter'] }) });
function write(path: '/v1/posts' | '/v1/calls', payload: unknown, options: { bad?: boolean; timestamp?: number; nonce?: string; signedPath?: string } = {}) {
  const message = JSON.stringify({ domain: 'tradgents:v1', path: options.signedPath ?? path, timestamp: options.timestamp ?? time, nonce: options.nonce ?? randomUUID(), payload });
  const signature = sign(null, Buffer.from(message), key);
  if (options.bad) signature[0] ^= 1;
  return app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature: signature.toString('base64') }) });
}
const post = (text = 'Plain thesis') => ({ agentSlug: 'test-agent', type: 'thesis', text });
const call = () => ({ agentSlug: 'test-agent', market: 'SOL/USD', direction: 'long', entry: 100, target: 120, stop: 90, expiresAt: time + 60_000, rationale: 'Momentum' });
const detailKeys = ['agent', 'equityUsd', 'tier', 'equity', 'interactions', 'metrics', 'byProtocol', 'waterfall', 'unrealizedUsd'];
const metricsKeys = ['window', 'days', 'trades', 'returnPct', 'solReturnPct', 'excessPct', 'sharpe', 'sharpeLo', 'sharpeHi', 'sortino', 'maxDrawdownPct', 'winRate', 'eligible'];
describe('read contracts', () => {
  it('reports database health', async () => { expect(await (await app.request('/v1/health')).json()).toEqual({ ok: true }); });
  it('returns sorted demo leaderboard with exact keys and metrics', async () => {
    seedDemo(store);
    const res = await app.request('/v1/leaderboard'), rows = await res.json() as LeaderboardRow[];
    expect(res.headers.get('X-Demo-Data')).toBe('true'); expect(rows.length).toBe(10);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['agent', 'equityUsd', 'tier', 'metrics', 'spark'].sort());
      expect(r.spark[0]).toBe(100);
      expect(Object.keys(r.metrics)).toEqual(['7d', '30d', 'all']);
      for (const m of Object.values(r.metrics)) expect(Object.keys(m).sort()).toEqual(metricsKeys.sort());
    }
    expect(rows.map(r => r.metrics['7d'].sharpe)).toEqual(rows.map(r => r.metrics['7d'].sharpe).sort((a, b) => b - a));
  });
  it('sorts by 30d return', async () => { seedDemo(store); const rows = await (await app.request('/v1/leaderboard?sort=return')).json() as LeaderboardRow[]; expect(rows.map(r => r.metrics['30d'].returnPct)).toEqual(rows.map(r => r.metrics['30d'].returnPct).sort((a, b) => b - a)); });
  it('returns agent detail fixture and demo header', async () => {
    const demo = seedDemo(store), fixture = [...demo.agents.values()][0];
    const res = await app.request(`/v1/agents/${fixture.agent.slug}`), d = await res.json() as AgentDetail;
    expect(res.headers.get('X-Demo-Data')).toBe('true'); expect(Object.keys(d).sort()).toEqual(detailKeys.sort());
    expect(d.agent).toEqual(fixture.agent); expect(d.equity).toEqual(fixture.equity);
    for (const window of ['7d', '30d', 'all'] as const) for (const field of metricsKeys) {
      const actual = d.metrics[window][field as keyof typeof d.metrics.all], expected = fixture.metrics[window][field as keyof typeof fixture.metrics.all];
      if (typeof actual === 'number') expect(actual).toBeCloseTo(expected as number, 10); else expect(actual).toEqual(expected);
    }
  });
  it('returns 404 only for unknown detail and unknown protocol', async () => { expect((await app.request('/v1/agents/unknown')).status).toBe(404); expect((await app.request('/v1/protocols/unknown')).status).toBe(404); });
  it('returns empty arrays for unknown agent filters', async () => { seedDemo(store); for (const path of ['/v1/feed?agent=unknown', '/v1/calls?agent=unknown']) expect(await (await app.request(path)).json()).toEqual([]); });
  it.each(['all', 'calls', 'trades', 'thesis'])('filters and joins feed %s', async filter => {
    const demo = seedDemo(store), agent = [...demo.agents.keys()][0];
    const res = await app.request(`/v1/feed?filter=${filter}&agent=${agent}&limit=3`), rows = await res.json() as PostView[];
    expect(rows.length).toBeLessThanOrEqual(3); expect(rows.length).toBeGreaterThan(0); expect(res.headers.get('X-Demo-Data')).toBe('true');
    for (const p of rows) { expect(p.agent.slug).toBe(agent); if (filter !== 'all') expect(p.type).toBe(filter === 'calls' ? 'call' : filter === 'trades' ? 'trade' : 'thesis'); if (p.callId) expect(p.call?.id).toBe(p.callId); if (p.interactionId) expect(p.interaction?.id).toBe(p.interactionId); }
  });
  it('returns call fixture shapes', async () => { seedDemo(store); const res = await app.request('/v1/calls'), rows = await res.json() as Call[]; expect(res.headers.get('X-Demo-Data')).toBe('true'); expect(rows.length).toBeGreaterThan(0); expect(rows[0]).toMatchObject({ id: expect.any(String), agentSlug: expect.any(String), rationale: expect.any(String), traded: expect.any(Boolean) }); });
  it('returns protocol aggregates matching detail totals', async () => {
    seedDemo(store); const res = await app.request('/v1/protocols'), rows = await res.json() as ProtocolPage[];
    expect(res.headers.get('X-Demo-Data')).toBe('true'); expect(rows).toHaveLength(8);
    for (const row of rows) { expect(Object.keys(row).sort()).toEqual(['protocol', 'agents', 'waterfall', 'totalPnl', 'totalTrades', 'kinds'].sort()); expect(row.totalTrades).toBe(row.kinds.reduce((s, k) => s + k.trades, 0)); const single = await app.request(`/v1/protocols/${row.protocol}`); expect(await single.json()).toEqual(row); expect(single.headers.get('X-Demo-Data')).toBe('true'); }
  });
  it.each(['/v1/feed?limit=-1', '/v1/feed?limit=201', '/v1/feed?filter=bad', '/v1/leaderboard?sort=bad'])('rejects invalid query %s', async path => expect((await app.request(path)).status).toBe(400));
  it('does not mark empty production data demo', async () => { for (const path of ['/v1/leaderboard', '/v1/feed', '/v1/calls', '/v1/protocols']) expect((await app.request(path)).headers.get('X-Demo-Data')).toBeNull(); });
});
describe('signed writes', () => {
  it('registers declared agent with persisted expiring UUID challenge', async () => {
    const res = await register(), body = await res.json(); expect(res.status).toBe(201); expect(body.agent.verification).toBe('declared'); expect(body.agent.bondSol).toBe(0); expect(body.challenge.id).toMatch(/^[0-9a-f-]{36}$/); expect(body.challenge.expiresAt).toBe(time + 300_000); expect(store.db.prepare('SELECT * FROM challenges').all()).toHaveLength(1);
    expect((await register()).status).toBe(409);
  });
  it('accepts valid signature and stores plain untrusted production post', async () => { await register(); const res = await write('/v1/posts', post()); expect(res.status).toBe(201); expect(await res.json()).toMatchObject({ text: 'Plain thesis', reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 }); expect(store.db.prepare('SELECT demo,untrusted FROM posts').get()).toMatchObject({ demo: 0, untrusted: 1 }); });
  it('rejects invalid signature without consuming rate quota', async () => { await register(); expect((await write('/v1/posts', post(), { bad: true })).status).toBe(401); expect((await write('/v1/posts', post())).status).toBe(201); });
  it('rate limits posts and calls jointly, allowing next second', async () => { await register(); expect((await write('/v1/posts', post())).status).toBe(201); const res = await write('/v1/calls', call()); expect(res.status).toBe(429); expect(res.headers.get('Retry-After')).toBe('1'); time += 1000; expect((await write('/v1/calls', call())).status).toBe(201); });
  it('persists rate limits across app restart', async () => { await register(); await write('/v1/posts', post()); app = createApp(store, () => time); expect((await write('/v1/posts', post())).status).toBe(429); });
  it('accepts signed call and creates joined feed post', async () => { await register(); const res = await write('/v1/calls', call()); expect(res.status).toBe(201); const c = await res.json(); expect(c).toMatchObject({ status: 'open', traded: false }); expect(store.db.prepare('SELECT untrusted FROM calls').get()).toMatchObject({ untrusted: 1 }); const feed = await (await app.request('/v1/feed?filter=calls')).json(); expect(feed[0].call).toEqual(c); });
  it.each([501, 0])('rejects post length %i', async length => { await register(); expect((await write('/v1/posts', post('x'.repeat(length)))).status).toBe(400); });
  it('accepts the 500 character boundary', async () => { await register(); expect((await write('/v1/posts', post('x'.repeat(500)))).status).toBe(201); });
  it('rejects long call rationale', async () => { await register(); expect((await write('/v1/calls', { ...call(), rationale: 'x'.repeat(501) })).status).toBe(400); });
  it('rejects HTML and control characters', async () => { await register(); for (const text of ['<script>alert(1)</script>', 'hello\u0000']) expect((await write('/v1/posts', post(text))).status).toBe(400); });
  it('rejects replay even after rate interval', async () => { await register(); const nonce = randomUUID(), timestamp = time; expect((await write('/v1/posts', post(), { nonce, timestamp })).status).toBe(201); time += 1000; expect((await write('/v1/posts', post(), { nonce, timestamp })).status).toBe(409); });
  it('rejects expired or future timestamp', async () => { await register(); for (const timestamp of [time - 300_001, time + 300_001]) expect((await write('/v1/posts', post(), { timestamp })).status).toBe(401); });
  it('rejects unknown wallet agent and wrong signing path', async () => { await register(); expect((await write('/v1/posts', { ...post(), agentSlug: 'unknown' })).status).toBe(401); expect((await write('/v1/posts', post(), { signedPath: '/v1/calls' })).status).toBe(401); });
  it('rejects expired call', async () => { await register(); expect((await write('/v1/calls', { ...call(), expiresAt: time })).status).toBe(400); });
  it('rejects malformed JSON and oversized request body', async () => { expect((await app.request('/v1/posts', { method: 'POST', body: '{' })).status).toBe(400); expect((await app.request('/v1/posts', { method: 'POST', body: 'x'.repeat(9000) })).status).toBe(413); });
});
it('computes bounded seed risk metrics from stored snapshots', async () => {
  seedDemo(store); const rows = await (await app.request('/v1/leaderboard')).json() as LeaderboardRow[];
  for (const row of rows) for (const m of Object.values(row.metrics)) {
    expect(Number.isFinite(m.sharpe)).toBe(true); expect(m.sharpe).toBeGreaterThan(-100); expect(m.sharpe).toBeLessThan(100);
    expect(Number.isFinite(m.sortino)).toBe(true); expect(m.sortino).toBeGreaterThan(-100); expect(m.sortino).toBeLessThan(200);
    expect(m.maxDrawdownPct).toBeGreaterThanOrEqual(0); expect(m.maxDrawdownPct).toBeLessThan(100);
    expect(m.sharpeLo).toBeLessThanOrEqual(m.sharpe); expect(m.sharpeHi).toBeGreaterThanOrEqual(m.sharpe);
  }
  expect(rows.some(r => r.metrics.all.maxDrawdownPct > 5)).toBe(true);
});
