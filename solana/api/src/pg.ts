import type { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';

export type Row = Record<string, unknown>;
/** The only database surface the app uses. Parameterized SQL, nothing else. */
export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs a multi-statement script with no parameters (migrations). */
  exec(text: string): Promise<void>;
}
export interface Db extends Sql {
  readonly kind: 'postgres' | 'pglite';
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  /** Runs fn only if this process wins the lock; the lock is held on a dedicated session until fn settles. */
  withAdvisoryLock<T>(key: number, fn: (lost: AbortSignal) => Promise<T>, opts?: { wait?: boolean }): Promise<T | undefined>;
  close(): Promise<void>;
}

/**
 * `memory:` and `pglite:<dir>` open an in-process PGlite (tests, single-process local trials; no real locking); anything else is a Postgres URL.
 * The Supabase transaction pooler does not support prepared statements, so they are off.
 */
export async function openDb(url: string, opts: { max?: number } = {}): Promise<Db> {
  if (url.startsWith('memory:') || url.startsWith('pglite:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = url.startsWith('pglite:') ? new PGlite(url.slice(7)) : new PGlite(); // pglite:<dir> persists locally for single-process trials
    const wrap = (q: { query: PGlite['query']; exec: PGlite['exec'] }): Sql => ({
      query: async <T>(text: string, params?: unknown[]) => (await q.query<T>(text, params as never)).rows,
      exec: async text => { await q.exec(text); },
    });
    let chain: Promise<unknown> = Promise.resolve(); // PGlite is single-connection; serialize transactions
    return {
      kind: 'pglite', ...wrap(lite),
      tx: fn => { const run = chain.then(() => lite.transaction(t => fn(wrap(t as never)))); chain = run.catch(() => undefined); return run; },
      withAdvisoryLock: async (_k, fn) => fn(new AbortController().signal),
      close: () => lite.close(),
    };
  }
  const sql = postgres(url, { max: opts.max ?? 10, prepare: false, idle_timeout: 20, connect_timeout: 10, onnotice: () => undefined,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require' });
  const wrap = (q: postgres.Sql | postgres.TransactionSql): Sql => ({
    query: async <T>(text: string, params?: unknown[]) => (await q.unsafe(text, (params ?? []) as never)) as unknown as T[],
    exec: async text => { await q.unsafe(text).simple(); },
  });
  return {
    kind: 'postgres', ...wrap(sql),
    tx: fn => sql.begin(t => fn(wrap(t))) as Promise<never>,
    async withAdvisoryLock(key, fn, o) {
      // A session lock only means something on a session-mode (direct) connection, which is why callers pass the direct URL.
      // A heartbeat on the same session detects a dropped connection (which silently releases the lock) and aborts `lost`.
      const conn = await sql.reserve(), lost = new AbortController();
      let beat: ReturnType<typeof setInterval> | undefined;
      try {
        if (o?.wait) await conn.unsafe('select pg_advisory_lock($1)', [key]);
        else {
          const [row] = await conn.unsafe('select pg_try_advisory_lock($1) as ok', [key]) as unknown as { ok: boolean }[];
          if (!row.ok) return undefined;
        }
        beat = setInterval(() => { conn.unsafe('select 1').catch(() => lost.abort()); }, 10_000);
        try { return await fn(lost.signal); } finally { await conn.unsafe('select pg_advisory_unlock($1)', [key]).catch(() => undefined); }
      } finally { if (beat) clearInterval(beat); conn.release(); }
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
