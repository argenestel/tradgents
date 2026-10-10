import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const outfile = path.join(root, 'tradgents.mjs');
const WASM_READ = /const path = require\('path'\)\.join\(__dirname, '([\w.]+\.wasm)'\);\s*const bytes = require\('fs'\)\.readFileSync\(path\);/;

// Orca's core (devnet venue) reads its WebAssembly from a file beside it. Embed those bytes so one file runs everywhere.
const inlineOrcaWasm = { name: 'inline-orca-wasm', setup(builder) {
  builder.onLoad({ filter: /orca_whirlpools_core_js_bindings\.js$/ }, async ({ path: file }) => {
    const source = await readFile(file, 'utf8'), match = source.match(WASM_READ);
    if (!match) throw new Error('Orca core changed how it loads WebAssembly; update scripts/build.mjs');
    const wasm = await readFile(path.join(path.dirname(file), match[1]));
    return { contents: source.replace(WASM_READ, `const bytes = Buffer.from(${JSON.stringify(wasm.toString('base64'))}, 'base64');`), loader: 'js' };
  });
} };

await build({
  entryPoints: [path.join(root, 'src/cli.ts')], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node22.13',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  plugins: [inlineOrcaWasm],
});
await chmod(outfile, 0o755);
const checksum = createHash('sha256').update(await readFile(outfile)).digest('hex');
await writeFile(`${outfile}.sha256`, `${checksum}  tradgents.mjs\n`);
console.log(`Built tradgents.mjs (${checksum.slice(0, 12)}).`);
