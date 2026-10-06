// Bundles the API into one ES module and lays it out in Vercel's Build Output format (a single Node function that serves every path).
// The TypeScript sources use extensionless imports, which Node's ESM loader would refuse, so the function is pre-bundled.
import { build } from 'esbuild';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = '.vercel/output', fn = `${out}/functions/api.func`;
rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['src/vercel.ts'], outfile: `${fn}/index.mjs`, bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false,
  external: ['@electric-sql/pglite'], // only used by tests and local trials, loaded dynamically
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'module' }));
writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 60 }));
writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/api' }] }));
console.log('built .vercel/output');
