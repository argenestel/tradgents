import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// On Postgres through the Supabase pooler, the `postgres` driver double-encodes a JSON string bound to a jsonb parameter
// (it is stored as a JSON string, not an object). PGlite does not, so tests would not notice. Bind as text and cast.
it('never binds a parameter directly as jsonb', () => {
  for (const f of readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.ts'))) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    expect(src.match(/\$\d+::jsonb/g) ?? [], f).toEqual([]);
  }
});
