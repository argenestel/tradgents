import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb, type Db } from './pg.ts';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const LOCK = 7_261_143;

/** Ordered, forward-only migrations. SHA-256 pins every applied file and a session lock serializes migrators. */
export async function migrate(db: Db, dir = DIR): Promise<string[]> {
  const run = async () => {
    await db.exec('create schema if not exists monad');
    await db.exec('create table if not exists monad.schema_migrations (name text primary key, sha256 text not null, applied_ms bigint not null default ((extract(epoch from clock_timestamp()) * 1000)::bigint))');
    const done = new Map((await db.query<{ name: string; sha256: string }>('select name,sha256 from monad.schema_migrations')).map(r => [r.name,r.sha256]));
    const applied: string[] = [];
    for (const file of readdirSync(dir).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort()) {
      const sql = readFileSync(`${dir}${file}`, 'utf8');
      const sha = createHash('sha256').update(sql).digest('hex');
      const prior = done.get(file);
      if (prior !== undefined) {
        if (prior !== sha) throw new Error(`Migration ${file} was edited after it was applied; add a new migration instead`);
        continue;
      }
      await db.tx(async q => {
        await q.exec(sql);
        await q.query('insert into monad.schema_migrations(name,sha256) values ($1,$2)', [file,sha]);
      });
      applied.push(file);
    }
    return applied;
  };
  return (await db.withAdvisoryLock(LOCK,run,{wait:true})) ?? [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error('Set DATABASE_URL_DIRECT to the direct (non-pooled) PostgreSQL URL');
  const db = await openDb(url,{max:2});
  try {
    const applied = await migrate(db);
    console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
  } finally { await db.close(); }
}
