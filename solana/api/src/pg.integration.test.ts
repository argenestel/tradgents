import { describe, expect, it } from 'vitest';
import { migrate } from './migrate';
import { openDb } from './pg';
import { Store } from './store';

// Runs only against a real Postgres: TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm test
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('real Postgres', () => {
  it('migrates, enforces least privilege for a login role, and serializes the advisory lock', async () => {
    const owner = await openDb(url!, { max: 4 });
    await owner.exec('drop schema if exists solana cascade; drop role if exists tradgents_api; drop role if exists stranger; drop role if exists tableowner; drop role if exists reader_api');
    expect(await migrate(owner)).toEqual(['0001_init.sql', '0002_roles.sql', '0003_split_roles.sql']);
    expect(await migrate(owner)).toEqual([]);
    await owner.exec("create role tradgents_api login password 'x' in role tradgents_app; create role stranger login password 'x'");
    const app = new URL(url!); app.username = 'tradgents_api'; app.password = 'x';
    const strangerUrl = new URL(url!); strangerUrl.username = 'stranger'; strangerUrl.password = 'x';
    const db = await openDb(app.toString(), { max: 2 });
    const store = new Store(db);
    await store.setState('k', 'v'); expect(await store.state('k')).toBe('v');
    await store.putRegistryEvent('sig', 0, 0, 1, { name: 'X', fields: { a: '1' } });
    expect(await owner.query('select jsonb_typeof(data) as t from solana.registry_events')).toEqual([{ t: 'object' }]); // not a JSON string
    await expect(db.query('select * from solana.schema_migrations')).rejects.toThrow(/permission denied/);
    await expect(db.query('create table solana.evil(a int)')).rejects.toThrow(/permission denied/);
    const stranger = await openDb(strangerUrl.toString(), { max: 1 });
    await expect(stranger.query('select * from solana.indexer_state')).rejects.toThrow(/permission denied/);
    // table owner without BYPASSRLS is still bound by FORCE RLS: no policy for it means no rows
    await owner.exec('create role tableowner nologin; grant usage on schema solana to tableowner; alter table solana.indexer_state owner to tableowner');
    expect(await owner.tx(async q => { await q.exec('set local role tableowner'); return q.query('select * from solana.indexer_state'); })).toEqual([]);
    await owner.exec('alter table solana.indexer_state owner to postgres; drop owned by tableowner; drop role tableowner');
    // the API's role reads what it serves and writes only signed-write tables; it cannot touch chain data, trades or stats
    await owner.exec("create role reader_api login password 'x' in role tradgents_read");
    const readerUrl = new URL(url!); readerUrl.username = 'reader_api'; readerUrl.password = 'x';
    const reader = await openDb(readerUrl.toString(), { max: 1 });
    expect(await reader.query('select value from solana.indexer_state')).toEqual([{ value: 'v' }]);
    await expect(reader.query("insert into solana.raw_transactions(signature,wallet,slot,block_ms,data) values ('s','w',1,1,'{}')")).rejects.toThrow(/permission denied/);
    await expect(reader.query('select * from solana.raw_transactions')).rejects.toThrow(/permission denied/);
    await expect(reader.query("insert into solana.trades(id,agent,ts_ms,data) values ('t','a',1,'{}')")).rejects.toThrow(/permission denied/);
    await expect(reader.query("update solana.agent_stats set tier='x'")).rejects.toThrow(/permission denied/);
    await reader.close();
    // transactions roll back as a unit
    await expect(store.tx(async s => { await s.setState('t', '1'); throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await store.state('t')).toBeUndefined();
    // only one holder of the advisory lock at a time
    const a = await openDb(url!, { max: 2 }), b = await openDb(url!, { max: 2 });
    let second: unknown = 'unset';
    const first = await a.withAdvisoryLock(42, async () => { second = await b.withAdvisoryLock(42, async () => 'got it'); return 'first'; });
    expect(first).toBe('first'); expect(second).toBeUndefined();
    expect(await b.withAdvisoryLock(42, async () => 'now free')).toBe('now free');
    for (const d of [a, b, stranger, db, owner]) await d.close();
  });
});
