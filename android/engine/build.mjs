// Builds the engine script that ships inside the app (core/engine/src/main/assets/engine.js) and smoke-tests it in a
// bare context with no Node, DOM or Web APIs, which is what the Android JavaScript sandbox offers.
import { build } from 'esbuild';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(here, '../core/engine/src/main/assets/engine.js');
mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [resolve(here, 'src/entry.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'neutral',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  tsconfig: resolve(here, 'tsconfig.json'),
  logLevel: 'warning',
});

const context = vm.createContext({});
vm.runInContext(readFileSync(outfile, 'utf8'), context);
const blank = JSON.parse(vm.runInContext('sipwiseCall("account.blank", "")', context));
if (!blank.ok) throw new Error(`Engine smoke test failed: ${blank.error}`);
console.log(`engine.js built (${(readFileSync(outfile).length / 1024).toFixed(0)} KB) and runs in a bare context.`);
