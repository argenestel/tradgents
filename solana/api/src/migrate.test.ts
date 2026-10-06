import { mkdtempSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { migrate } from './migrate';
import { openDb } from './pg';

it('applies migrations once, enables and forces RLS on every table, and is idempotent', async () => {
  const db = await openDb('memory:');
  expect(await migrate(db)).toEqual(['0001_init.sql', '0002_roles.sql', '0003_split_roles.sql']);
  expect(await migrate(db)).toEqual([]);
  const tables = await db.query<{ tablename: string; rowsecurity: boolean; forcerowsecurity: boolean }>(
    "select c.relname as tablename, c.relrowsecurity as rowsecurity, c.relforcerowsecurity as forcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='solana' and c.relkind='r' and c.relname <> 'schema_migrations'");
  expect(tables.length).toBeGreaterThanOrEqual(13);
  expect(tables.filter(t => !t.rowsecurity || !t.forcerowsecurity)).toEqual([]);
  await db.close();
});
it('lets the app role read and write but locks out other roles', async () => {
  const db = await openDb('memory:');
  await migrate(db);
  await db.exec("create role stranger nologin; create role anon nologin;");
  await db.exec("set role tradgents_app");
  await db.query("insert into solana.indexer_state(key,value) values ('k','v')");
  expect(await db.query('select value from solana.indexer_state')).toEqual([{ value: 'v' }]);
  await db.exec('reset role');
  await db.exec('set role stranger');
  await expect(db.query('select * from solana.indexer_state')).rejects.toThrow(/permission denied/);
  await db.exec('reset role');
  await db.close();
});
it('rejects a migration that was edited after being applied, and rolls a failing one back', async () => {
  const dir = mkdtempSync('/tmp/mig-') + '/';
  writeFileSync(`${dir}0001_a.sql`, 'create table solana.x(a int);');
  const db = await openDb('memory:');
  await migrate(db, dir);
  writeFileSync(`${dir}0001_a.sql`, 'create table solana.x(a int, b int);');
  await expect(migrate(db, dir)).rejects.toThrow(/edited after/);
  writeFileSync(`${dir}0001_a.sql`, 'create table solana.x(a int);');
  writeFileSync(`${dir}0002_bad.sql`, 'create table solana.y(a int); select 1/0;');
  await expect(migrate(db, dir)).rejects.toThrow();
  expect(await db.query("select 1 from pg_tables where schemaname='solana' and tablename='y'")).toEqual([]);
  await db.close();
});
