import type { PGlite } from '@electric-sql/pglite';
import postgres from 'postgres';

export type Row = Record<string, unknown>;
export interface Sql {
  query<T = Row>(text: string, params?: unknown[]): Promise<T[]>;
  exec(text: string): Promise<void>;
}
export interface Db extends Sql {
  readonly kind: 'postgres' | 'pglite';
  tx<T>(fn: (q: Sql) => Promise<T>): Promise<T>;
  withAdvisoryLock<T>(key: number, fn: () => Promise<T>, opts?: { wait?: boolean; onLost?: (error: unknown) => void }): Promise<T | undefined>;
  close(): Promise<void>;
}

/** PGlite is only for tests/local fixtures. Runtime URLs always use PostgreSQL with prepare disabled for Supabase poolers. */
export async function openDb(url: string, opts: { max?: number } = {}): Promise<Db> {
  if (url === 'memory:' || url.startsWith('memory:')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const lite = new PGlite();
    const wrap = (q: { query: PGlite['query']; exec: PGlite['exec'] }): Sql => ({
      query: async <T>(text: string, params?: unknown[]) => (await q.query<T>(text, params as never)).rows,
      exec: async text => { await q.exec(text); },
    });
    let chain: Promise<unknown> = Promise.resolve();
    return {
      kind: 'pglite', ...wrap(lite),
      tx: fn => { const run = chain.then(() => lite.transaction(t => fn(wrap(t as never)))); chain = run.catch(() => undefined); return run; },
      withAdvisoryLock: async (_key, fn) => fn(),
      close: () => lite.close(),
    };
  }
  const sql = postgres(url, {
    max: opts.max ?? 10, prepare: false, idle_timeout: 20, connect_timeout: 10,
    onnotice: () => undefined, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : 'require',
  });
  const wrap = (q: postgres.Sql | postgres.TransactionSql): Sql => ({
    query: async <T>(text: string, params?: unknown[]) => (await q.unsafe(text, (params ?? []) as never)) as unknown as T[],
    exec: async text => { await q.unsafe(text).simple(); },
  });
  return {
    kind: 'postgres', ...wrap(sql),
    tx: fn => sql.begin(t => fn(wrap(t))) as Promise<never>,
    async withAdvisoryLock(key, fn, opts) {
      const conn = await sql.reserve();
      try {
        if (opts?.wait) await conn.unsafe('select pg_advisory_lock($1)', [key]);
        else {
          const [row] = await conn.unsafe('select pg_try_advisory_lock($1) as ok', [key]) as unknown as { ok: boolean }[];
          if (!row.ok) return undefined;
        }
        let ping:Promise<unknown>|undefined;
        const heartbeat=setInterval(()=>{if(!ping)ping=conn.unsafe('select 1').then(()=>undefined).catch(error=>{opts?.onLost?.(error);}).finally(()=>{ping=undefined;});},10_000);
        heartbeat.unref?.();
        try { return await fn(); } finally { clearInterval(heartbeat);if(ping)await ping;try{await conn.unsafe('select pg_advisory_unlock($1)', [key]);}catch(error){opts?.onLost?.(error);} }
      } finally { conn.release(); }
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
