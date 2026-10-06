import { expect,it } from 'vitest';
import { migrate } from '../src/migrate.ts';
import { openDb } from '../src/pg.ts';

it('applies migrations once, enables and forces RLS, and is idempotent',async()=>{
  const db=await openDb('memory:');
  expect(await migrate(db)).toEqual(['0001_init.sql','0002_roles.sql','0003_integrity_nonces_ledger.sql']);expect(await migrate(db)).toEqual([]);
  const tables=await db.query<{tablename:string;rowsecurity:boolean;forcerowsecurity:boolean}>("select c.relname tablename,c.relrowsecurity rowsecurity,c.relforcerowsecurity forcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='monad' and c.relkind='r' and c.relname<>'schema_migrations'");
  expect(tables.length).toBeGreaterThanOrEqual(15);expect(tables.filter(t=>!t.rowsecurity||!t.forcerowsecurity)).toEqual([]);await db.close();
});
it('grants app-role access and denies stranger, anon, authenticated and PUBLIC',async()=>{
  const db=await openDb('memory:');await migrate(db);await db.exec('create role stranger nologin; create role anon nologin; create role authenticated nologin;');
  await db.exec('set role tradgents_app');await db.query("insert into monad.indexer_state(key,value,updated_ms) values('fixture','1',1)");expect(await db.query("select value from monad.indexer_state where key='fixture'")).toEqual([{value:'1'}]);await db.exec('reset role');
  const access=await db.query<{rolname:string;schema_access:boolean;table_access:boolean}>("select rolname,has_schema_privilege(rolname,'monad','usage') schema_access,has_table_privilege(rolname,'monad.indexer_state','select') table_access from pg_roles where rolname in ('stranger','anon','authenticated')");
  expect(access).toHaveLength(3);expect(access.some(r=>r.schema_access||r.table_access)).toBe(false);
  const publicGrants=await db.query<{n:string}>("select count(*) n from pg_namespace n cross join lateral aclexplode(n.nspacl) acl where n.nspname='monad' and acl.grantee=0");expect(Number(publicGrants[0].n)).toBe(0);
  await db.close();
});
it('rejects an already-recorded migration with a changed checksum',async()=>{
  const db=await openDb('memory:');await migrate(db);
  await db.query("update monad.schema_migrations set sha256='00' where name='0001_init.sql'");
  await expect(migrate(db)).rejects.toThrow(/edited after it was applied/);await db.close();
});
