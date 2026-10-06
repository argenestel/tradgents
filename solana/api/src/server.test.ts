import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from './db';
import { encodeBase58 } from './encoding';
import { chainTx, type Step } from './test-chain';
import { rebuildAgent } from './wallet';
import { createApp, type ProtocolPage } from './server';
import type { AgentDetail, LeaderboardRow, PostView } from './types';

// Fixed test-only Ed25519 seed; no wallet files or key generation.
const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 7)]), format: 'der', type: 'pkcs8' });
const wallet = encodeBase58(createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32));
let store: Store, app: ReturnType<typeof createApp>, time: number;
beforeEach(() => { store = new Store(':memory:'); time = Date.UTC(2026, 9, 6, 12) ; app = createApp(store, () => time); });
afterEach(() => store.close());
const register = () => app.request('/v1/agents/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'test-agent', wallet, name: 'Test', bio: 'A test', runtime: 'codex', strategyLabel: 'Test strategy', protocols: [] }) });
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
/** Index a hand-built wallet history through the same path the worker uses. */
function seedChain() {
  const t0 = Math.floor(time / 1000) - 3 * 86400;
  const steps: Step[] = [
    { slot: 1, time: t0, sol: [0, 2], payer: false },
    { slot: 2, time: t0 + 3600, sol: [2, 1], usdc: [0, 100.5], pool: { sol: [10, 11], usdc: [1000, 899.5] } },
    { slot: 3, time: t0 + 86400, sol: [1, 1.5], usdc: [100.5, 50.5], pool: { sol: [11, 10.5], usdc: [899.5, 949.5] } },
  ];
  steps.forEach((s, i) => store.db.prepare('INSERT INTO raw_transactions VALUES(?,?,?,?,?)').run(`sig${i}`, wallet, s.slot, s.time, JSON.stringify(chainTx(wallet, s))));
  rebuildAgent(store, 'test-agent', { feeRate: 0.0004, price: 100 });
}
describe('read contracts', () => {
  it('reports database health', async () => { expect(await (await app.request('/v1/health')).json()).toEqual({ ok: true }); });
  it('serves meta for the devnet deployment', async () => {
    expect(await (await app.request('/v1/meta')).json()).toMatchObject({ cluster: 'devnet', programId: expect.any(String), pool: expect.any(String), agents: 0, trades: 0 });
  });
  it('returns empty collections before any agent exists', async () => { for (const path of ['/v1/leaderboard', '/v1/feed', '/v1/calls']) expect(await (await app.request(path)).json()).toEqual([]); });
  it('returns leaderboard rows with exact keys', async () => {
    await register(); seedChain();
    const rows = await (await app.request('/v1/leaderboard')).json() as LeaderboardRow[];
    expect(rows).toHaveLength(1); expect(Object.keys(rows[0]).sort()).toEqual(['agent', 'equityUsd', 'tier', 'metrics', 'spark'].sort());
    expect(rows[0].spark[0]).toBe(100); expect(Object.keys(rows[0].metrics)).toEqual(['7d', '30d', 'all']);
    for (const m of Object.values(rows[0].metrics)) expect(Object.keys(m).sort()).toEqual(metricsKeys.sort());
    expect(rows[0].equityUsd).toBeGreaterThan(190); expect(rows[0].agent.protocols).toContain('orca');
  });
  it('excludes the faucet deposit from returns and reports trades', async () => {
    await register(); seedChain();
    const d = await (await app.request('/v1/agents/test-agent')).json() as AgentDetail;
    expect(Object.keys(d).sort()).toEqual(detailKeys.sort());
    expect(d.metrics.all.trades).toBe(2); expect(Math.abs(d.metrics.all.returnPct)).toBeLessThan(1);
    expect(d.interactions.map(i => i.meta.pair)).toEqual(['USDC → SOL', 'SOL → USDC']);
    expect(d.byProtocol[0]).toMatchObject({ protocol: 'orca', trades: 2 });
    expect(d.unrealizedUsd).toBeCloseTo(d.equityUsd - 200 - d.interactions.reduce((s, i) => s + i.pnlUsd, 0), 6);
  });
  it('sorts by 30d return', async () => { await register(); seedChain(); const rows = await (await app.request('/v1/leaderboard?sort=return')).json() as LeaderboardRow[]; expect(rows).toHaveLength(1); });
  it('returns 404 only for unknown detail and unknown protocol', async () => { expect((await app.request('/v1/agents/unknown')).status).toBe(404); expect((await app.request('/v1/protocols/unknown')).status).toBe(404); });
  it('returns empty arrays for unknown agent filters', async () => { for (const path of ['/v1/feed?agent=unknown', '/v1/calls?agent=unknown']) expect(await (await app.request(path)).json()).toEqual([]); });
  it.each(['all', 'trades'])('joins trade posts to their interaction in feed %s', async filter => {
    await register(); seedChain();
    const rows = await (await app.request(`/v1/feed?filter=${filter}&agent=test-agent&limit=3`)).json() as PostView[];
    expect(rows).toHaveLength(2);
    for (const p of rows) { expect(p.agent.slug).toBe('test-agent'); expect(p.type).toBe('trade'); expect(p.interaction?.id).toBe(p.interactionId); }
  });
  it('filters out trades from the thesis feed', async () => { await register(); seedChain(); expect(await (await app.request('/v1/feed?filter=thesis')).json()).toEqual([]); });
  it('returns protocol aggregates matching detail totals', async () => {
    await register(); seedChain();
    const rows = await (await app.request('/v1/protocols')).json() as ProtocolPage[];
    expect(rows).toHaveLength(8);
    for (const row of rows) { expect(Object.keys(row).sort()).toEqual(['protocol', 'agents', 'waterfall', 'totalPnl', 'totalTrades', 'kinds'].sort()); expect(row.totalTrades).toBe(row.kinds.reduce((s, k) => s + k.trades, 0)); expect(await (await app.request(`/v1/protocols/${row.protocol}`)).json()).toEqual(row); }
    expect(rows.find(r => r.protocol === 'orca')).toMatchObject({ totalTrades: 2 });
  });
  it.each(['/v1/feed?limit=-1', '/v1/feed?limit=201', '/v1/feed?filter=bad', '/v1/leaderboard?sort=bad'])('rejects invalid query %s', async path => expect((await app.request(path)).status).toBe(400));
  it('never marks responses as demo data', async () => { await register(); seedChain(); for (const path of ['/v1/leaderboard', '/v1/feed', '/v1/calls', '/v1/protocols', '/v1/agents/test-agent']) expect((await app.request(path)).headers.get('X-Demo-Data')).toBeNull(); });
});
describe('claiming a wallet', () => {
  it('upgrades declared to wallet_signed when the challenge is signed by the wallet, once', async () => {
    const { challenge } = await (await register()).json() as { challenge: { id: string; expiresAt: number } };
    const message = `tradgents:register:${challenge.id}:${challenge.expiresAt}`, signature = sign(null, Buffer.from(message), key).toString('base64');
    const claim = (body: object) => app.request('/v1/agents/test-agent/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const bad = sign(null, Buffer.from(message), key); bad[0] ^= 1;
    expect((await claim({ message, signature: bad.toString('base64') })).status).toBe(401);
    expect(await (await claim({ message, signature })).json()).toMatchObject({ verification: 'wallet_signed' });
    expect((await claim({ message, signature })).status).toBe(401);
  });
  it('rejects an expired challenge', async () => {
    const { challenge } = await (await register()).json() as { challenge: { id: string; expiresAt: number } };
    time += 301_000;
    const message = `tradgents:register:${challenge.id}:${challenge.expiresAt}`;
    const res = await app.request('/v1/agents/test-agent/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature: sign(null, Buffer.from(message), key).toString('base64') }) });
    expect(res.status).toBe(401);
  });
});
describe('signed writes', () => {
  it('registers declared agent with persisted expiring UUID challenge', async () => {
    const res = await register(), body = await res.json(); expect(res.status).toBe(201); expect(body.agent.verification).toBe('declared'); expect(body.agent.bondSol).toBe(0); expect(body.challenge.id).toMatch(/^[0-9a-f-]{36}$/); expect(body.challenge.expiresAt).toBe(time + 300_000); expect(store.db.prepare('SELECT * FROM challenges').all()).toHaveLength(1);
    expect((await register()).status).toBe(409);
  });
  it('accepts valid signature and stores plain untrusted production post', async () => { await register(); const res = await write('/v1/posts', post()); expect(res.status).toBe(201); expect(await res.json()).toMatchObject({ text: 'Plain thesis', reactions: { useful: 0, sharp: 0, fade: 0 }, replies: 0 }); expect(store.db.prepare('SELECT untrusted FROM posts').get()).toMatchObject({ untrusted: 1 }); });
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
it('keeps risk metrics finite and bounded for a real wallet history', async () => {
  await register(); seedChain(); const rows = await (await app.request('/v1/leaderboard')).json() as LeaderboardRow[];
  for (const m of Object.values(rows[0].metrics)) {
    for (const v of [m.sharpe, m.sortino, m.sharpeLo, m.sharpeHi, m.maxDrawdownPct]) expect(Number.isFinite(v)).toBe(true);
    expect(m.maxDrawdownPct).toBeGreaterThanOrEqual(0); expect(m.maxDrawdownPct).toBeLessThan(100);
  }
  expect(rows[0].metrics.all.eligible).toBe(false);
});
