import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDb, type Db } from './pg';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const LOCK = 7_261_001; // advisory lock key shared by every migrator of this schema

/**
 * Applies migrations/NNNN_name.sql in order, once each, each inside a transaction.
 * Each file's sha256 is recorded; a changed file that was already applied is an error, never silently skipped.
 * Concurrent runners serialize on an advisory lock. Forward-only: add a new file, never edit an applied one.
 */
export async function migrate(db: Db, dir = DIR): Promise<string[]> {
  const run = async () => {
    await db.exec('create schema if not exists solana');
    await db.exec('create table if not exists solana.schema_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())');
    const done = new Map((await db.query<{ name: string; sha256: string }>('select name, sha256 from solana.schema_migrations')).map(r => [r.name, r.sha256]));
    const applied: string[] = [];
    for (const file of readdirSync(dir).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort()) {
      const sql = readFileSync(`${dir}${file}`, 'utf8'), sha = createHash('sha256').update(sql).digest('hex');
      const prior = done.get(file);
      if (prior !== undefined) { if (prior !== sha) throw new Error(`Migration ${file} was edited after it was applied; add a new migration instead`); continue; }
      await db.tx(async q => { await q.exec(sql); await q.query('insert into solana.schema_migrations(name, sha256) values ($1,$2)', [file, sha]); });
      applied.push(file);
    }
    return applied;
  };
  const result = await db.withAdvisoryLock(LOCK, run, { wait: true });
  return result ?? [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error('Set DATABASE_URL_DIRECT (the direct, non-pooled connection string; migrations need a session)');
  const db = await openDb(url, { max: 2 });
  try { const applied = await migrate(db); console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date'); } finally { await db.close(); }
}
