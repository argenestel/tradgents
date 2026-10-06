import type { Db, Sql } from './pg';
import type { Agent, AgentDetail, Call, EquityPoint, Interaction, LeaderboardRow, Post } from './types';

type Q = Pick<Sql, 'query'>;
const n = (v: unknown) => Number(v);
export type Valuation = EquityPoint & { flow?: number };
export interface Flags { unsupportedTs: number[]; unpricedTouchTs: number[]; unpricedHeld: string[]; drift: boolean; depegTs?: number[] }
export type StatsRow = Pick<LeaderboardRow, 'equityUsd' | 'tier' | 'metrics' | 'spark'> & { notes: string[]; flags: Flags };

/** All SQL lives here. Everything is parameterized; JSON payloads go through jsonb. */
export class Store {
  constructor(readonly db: Db, private readonly sql: Q = db) {}
  /** Runs fn in one transaction; nested calls join the surrounding one. */
  tx<T>(fn: (s: Store) => Promise<T>): Promise<T> {
    return this.sql === this.db ? this.db.tx(q => fn(new Store(this.db, q))) : fn(this);
  }
  private get q(): Q { return this.sql; }

  // --- agents
  async agents(): Promise<Agent[]> { return (await this.q.query<{ data: Agent }>('select data from solana.agents order by slug')).map(r => r.data); }
  async agent(slug: string): Promise<Agent | undefined> { return (await this.q.query<{ data: Agent }>('select data from solana.agents where slug=$1', [slug]))[0]?.data; }
  async agentByWallet(wallet: string): Promise<Agent | undefined> { return (await this.q.query<{ data: Agent }>('select data from solana.agents where wallet=$1', [wallet]))[0]?.data; }
  async putAgent(a: Agent) { await this.q.query('insert into solana.agents(slug,wallet,data) values ($1,$2,$3::text::jsonb)', [a.slug, a.wallet, JSON.stringify(a)]); }
  async updateAgent(a: Agent) { await this.q.query('update solana.agents set data=$2::text::jsonb where slug=$1', [a.slug, JSON.stringify(a)]); }

  // --- indexer state
  async state(key: string): Promise<string | undefined> { return (await this.q.query<{ value: string }>('select value from solana.indexer_state where key=$1', [key]))[0]?.value; }
  async setState(key: string, value: string) { await this.q.query('insert into solana.indexer_state(key,value) values ($1,$2) on conflict (key) do update set value=excluded.value', [key, value]); }

  // --- raw chain data
  async putRaw(signature: string, wallet: string, slot: number, blockMs: number, tx: unknown): Promise<boolean> {
    return (await this.q.query('insert into solana.raw_transactions(signature,wallet,slot,block_ms,data) values ($1,$2,$3,$4,$5::text::jsonb) on conflict do nothing returning signature',
      [signature, wallet, slot, blockMs, JSON.stringify(tx)])).length > 0;
  }
  async rawFor(wallet: string, afterSlot: number): Promise<{ signature: string; slot: number; data: unknown }[]> {
    return (await this.q.query<{ signature: string; slot: string; data: unknown }>(`select signature,slot,data from solana.raw_transactions where wallet=$1 and slot>$2 order by slot, coalesce((data->>'transactionIndex')::int, 0), signature`, [wallet, afterSlot]))
      .map(r => ({ signature: r.signature, slot: n(r.slot), data: r.data }));
  }
  async putOpening(agent: string, o: { slot: number; tsMs: number; balances: unknown; prices: unknown }) {
    await this.q.query('insert into solana.openings(agent,slot,ts_ms,balances,prices) values ($1,$2,$3,$4::text::jsonb,$5::text::jsonb) on conflict (agent) do nothing',
      [agent, o.slot, o.tsMs, JSON.stringify(o.balances), JSON.stringify(o.prices)]);
  }
  async opening(agent: string): Promise<{ slot: number; tsMs: number; balances: Record<string, { raw: string; decimals: number }>; prices: Record<string, number> } | undefined> {
    const r = (await this.q.query<{ slot: string; ts_ms: string; balances: never; prices: never }>('select slot,ts_ms,balances,prices from solana.openings where agent=$1', [agent]))[0];
    return r && { slot: n(r.slot), tsMs: n(r.ts_ms), balances: r.balances, prices: r.prices };
  }

  // --- derived: trades, trade posts, per-transaction equity. Replaced wholesale by replay.
  async replaceDerived(agent: string, d: { trades: Interaction[]; posts: Post[]; points: { ts: number; usd: number; sol: number; flow: number }[] }) {
    await this.tx(async s => {
      await s.q.query('delete from solana.trades where agent=$1', [agent]);
      await s.q.query("delete from solana.posts where agent=$1 and type='trade'", [agent]);
      await s.q.query("delete from solana.equity where agent=$1 and src='tx'", [agent]);
      for (const t of d.trades) await s.q.query('insert into solana.trades(id,agent,ts_ms,data) values ($1,$2,$3,$4::text::jsonb)', [t.id, agent, t.ts, JSON.stringify(t)]);
      for (const p of d.posts) await s.q.query("insert into solana.posts(id,agent,ts_ms,type,data) values ($1,$2,$3,'trade',$4::text::jsonb)", [p.id, agent, p.ts, JSON.stringify(p)]);
      for (const p of d.points) await s.q.query("insert into solana.equity(agent,ts_ms,usd,sol_price,flow,src) values ($1,$2,$3,$4,$5,'tx') on conflict (agent,ts_ms) do update set usd=excluded.usd, sol_price=excluded.sol_price, flow=excluded.flow, src='tx'", [agent, p.ts, p.usd, p.sol, p.flow]);
    });
  }
  async putMark(agent: string, p: EquityPoint) {
    await this.q.query("insert into solana.equity(agent,ts_ms,usd,sol_price,flow,src) values ($1,$2,$3,$4,0,'mark') on conflict (agent,ts_ms) do nothing", [agent, p.t, p.usd, p.sol]);
  }
  async lastEquityTs(agent: string): Promise<number | undefined> {
    const r = (await this.q.query<{ t: string | null }>('select max(ts_ms) as t from solana.equity where agent=$1', [agent]))[0];
    return r?.t == null ? undefined : n(r.t);
  }
  async equity(agent: string): Promise<Valuation[]> {
    return (await this.q.query<{ ts_ms: string; usd: string; sol_price: string; flow: string }>('select ts_ms,usd,sol_price,flow from solana.equity where agent=$1 order by ts_ms', [agent]))
      .map(r => ({ t: n(r.ts_ms), usd: n(r.usd), sol: n(r.sol_price), flow: n(r.flow) }));
  }
  async trades(agent: string): Promise<Interaction[]> { return (await this.q.query<{ data: Interaction }>('select data from solana.trades where agent=$1 order by ts_ms desc, id', [agent])).map(r => r.data); }
  async allTrades(): Promise<Interaction[]> { return (await this.q.query<{ data: Interaction }>('select data from solana.trades order by ts_ms desc, id')).map(r => r.data); }
  async trade(id: string): Promise<Interaction | undefined> { return (await this.q.query<{ data: Interaction }>('select data from solana.trades where id=$1', [id]))[0]?.data; }

  // --- stats (leaderboard cache)
  async putStats(agent: string, s: StatsRow, nowMs: number) {
    await this.q.query(`insert into solana.agent_stats(agent,updated_ms,equity_usd,tier,metrics,spark,notes,flags) values ($1,$2,$3,$4,$5::text::jsonb,$6::text::jsonb,$7::text::jsonb,$8::text::jsonb)
      on conflict (agent) do update set updated_ms=excluded.updated_ms, equity_usd=excluded.equity_usd, tier=excluded.tier, metrics=excluded.metrics, spark=excluded.spark, notes=excluded.notes, flags=excluded.flags`,
      [agent, nowMs, s.equityUsd, s.tier, JSON.stringify(s.metrics), JSON.stringify(s.spark), JSON.stringify(s.notes), JSON.stringify(s.flags)]);
  }
  async leaderboard(): Promise<LeaderboardRow[]> {
    const rows = await this.q.query<{ agent: Agent; equity_usd: string; tier: LeaderboardRow['tier']; metrics: LeaderboardRow['metrics']; spark: number[]; notes: string[] }>(
      'select a.data as agent, s.equity_usd, s.tier, s.metrics, s.spark, s.notes from solana.agent_stats s join solana.agents a on a.slug=s.agent order by a.slug');
    return rows.map(r => ({ agent: r.agent, equityUsd: n(r.equity_usd), tier: r.tier, metrics: r.metrics, spark: r.spark, notes: r.notes }));
  }
  async stats(agent: string): Promise<{ notes: string[]; flags: Flags } | undefined> {
    return (await this.q.query<{ notes: string[]; flags: Flags }>('select notes, flags from solana.agent_stats where agent=$1', [agent]))[0];
  }

  // --- price samples
  async putSamples(rows: { mint: string; ts: number; usd: number; liquidity: number | null; source: string }[]) {
    for (const r of rows) await this.q.query('insert into solana.price_samples(mint,ts_ms,usd,liquidity_usd,source) values ($1,$2,$3,$4,$5) on conflict do nothing', [r.mint, r.ts, r.usd, r.liquidity, r.source]);
  }
  async samples(mints: string[], sinceMs: number): Promise<Map<string, { ts: number; usd: number }[]>> {
    const rows = await this.q.query<{ mint: string; ts_ms: string; usd: string }>('select mint, ts_ms, usd from solana.price_samples where mint = any($1::text[]) and ts_ms >= $2 order by mint, ts_ms', [mints, sinceMs]);
    const out = new Map<string, { ts: number; usd: number }[]>();
    for (const r of rows) (out.get(r.mint) ?? out.set(r.mint, []).get(r.mint)!).push({ ts: n(r.ts_ms), usd: n(r.usd) });
    return out;
  }
  async latestSample(mint: string): Promise<{ ts: number; usd: number } | undefined> {
    const r = (await this.q.query<{ ts_ms: string; usd: string }>('select ts_ms, usd from solana.price_samples where mint=$1 order by ts_ms desc limit 1', [mint]))[0];
    return r && { ts: n(r.ts_ms), usd: n(r.usd) };
  }

  // --- registry events
  async putRegistryEvent(sig: string, ix: number, index: number, slot: number, event: unknown): Promise<boolean> {
    return (await this.q.query('insert into solana.registry_events(signature,ix_index,event_index,slot,data) values ($1,$2,$3,$4,$5::text::jsonb) on conflict do nothing returning signature', [sig, ix, index, slot, JSON.stringify(event)])).length > 0;
  }

  // --- signed writes: nonces, quotas, challenges
  async challenge(wallet: string, message: string) {
    const r = (await this.q.query<{ id: string; expires_ms: string; used: boolean }>('select id, expires_ms, used from solana.challenges where wallet=$1 and message=$2', [wallet, message]))[0];
    return r && { id: r.id, expires: n(r.expires_ms), used: r.used };
  }
  async putChallenge(id: string, wallet: string, message: string, metadata: unknown, expires: number) {
    await this.q.query('insert into solana.challenges(id,wallet,message,metadata,expires_ms) values ($1,$2,$3,$4::text::jsonb,$5)', [id, wallet, message, JSON.stringify(metadata), expires]);
  }
  async useChallenge(id: string) { await this.q.query('update solana.challenges set used=true where id=$1', [id]); }
  /** Returns 'replay' | 'rate' | undefined (ok, nonce consumed and quota stamped). Call inside tx. */
  async consumeWrite(wallet: string, slug: string, nonce: string, nonceExpiresMs: number, nowMs: number, minGapMs: number): Promise<'replay' | 'rate' | undefined> {
    await this.q.query('select pg_advisory_xact_lock(hashtext($1))', ['write:' + slug]); // serializes first writes, when there is no quota row to lock yet
    await this.q.query('delete from solana.nonces where expires_ms < $1', [nowMs]);
    if ((await this.q.query('select 1 from solana.nonces where wallet=$1 and nonce=$2', [wallet, nonce])).length) return 'replay';
    const quota = (await this.q.query<{ last_ms: string }>("select last_ms from solana.quotas where principal=$1 and kind='write' for update", [slug]))[0];
    if (quota && nowMs - n(quota.last_ms) < minGapMs) return 'rate';
    await this.q.query('insert into solana.nonces(wallet,nonce,expires_ms) values ($1,$2,$3)', [wallet, nonce, nonceExpiresMs]);
    await this.q.query("insert into solana.quotas(principal,kind,last_ms) values ($1,'write',$2) on conflict (principal,kind) do update set last_ms=excluded.last_ms", [slug, nowMs]);
    return undefined;
  }
  async putPost(p: Post) { await this.q.query('insert into solana.posts(id,agent,ts_ms,type,data) values ($1,$2,$3,$4,$5::text::jsonb)', [p.id, p.agentSlug, p.ts, p.type, JSON.stringify(p)]); }
  async putCall(c: Call) { await this.q.query('insert into solana.calls(id,agent,ts_ms,data) values ($1,$2,$3,$4::text::jsonb)', [c.id, c.agentSlug, c.createdAt, JSON.stringify(c)]); }

  // --- feed and calls
  async feed(o: { agent?: string; type?: Post['type']; limit: number }): Promise<{ post: Post; agent: Agent; interaction?: Interaction; call?: Call }[]> {
    const where: string[] = [], args: unknown[] = [];
    if (o.agent !== undefined) { args.push(o.agent); where.push(`p.agent=$${args.length}`); }
    if (o.type) { args.push(o.type); where.push(`p.type=$${args.length}`); }
    args.push(o.limit);
    const rows = await this.q.query<{ post: Post; agent: Agent; interaction: Interaction | null; call: Call | null }>(
      `select p.data as post, a.data as agent, t.data as interaction, c.data as call from solana.posts p
       join solana.agents a on a.slug=p.agent
       left join solana.trades t on t.id=p.data->>'interactionId'
       left join solana.calls c on c.id=p.data->>'callId'
       ${where.length ? 'where ' + where.join(' and ') : ''} order by p.ts_ms desc, p.id desc limit $${args.length}`, args);
    return rows.map(r => ({ post: r.post, agent: r.agent, ...(r.interaction ? { interaction: r.interaction } : {}), ...(r.call ? { call: r.call } : {}) }));
  }
  async calls(agent?: string): Promise<Call[]> {
    return (await this.q.query<{ data: Call }>(`select data from solana.calls ${agent !== undefined ? 'where agent=$1' : ''} order by ts_ms desc, id desc`, agent !== undefined ? [agent] : [])).map(r => r.data);
  }

  // --- counters for /v1/meta
  async counts(): Promise<{ agents: number; trades: number }> {
    const r = (await this.q.query<{ agents: number; trades: number }>('select (select count(*) from solana.agents)::int as agents, (select count(*) from solana.trades)::int as trades'))[0];
    return { agents: r.agents, trades: r.trades };
  }
  async registryEvents(): Promise<{ name: string; fields: Record<string, string | boolean> }[]> {
    return (await this.q.query<{ data: { name: string; fields: Record<string, string | boolean> } }>('select data from solana.registry_events order by slot, ix_index, event_index')).map(r => r.data);
  }
}
export type { AgentDetail };
