// Writes the engine's real replies for the test account into core/model test resources, so the Kotlin view-model
// types are checked against what the shared TypeScript actually returns. Run from the repo root:
//   node android/engine/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildTestAccount } from '../../lib/test-seed/account.ts';
import { call } from './src/handlers.ts';

const dir = new URL('../core/model/src/test/resources/', import.meta.url);
mkdirSync(dir, { recursive: true });
const account = JSON.parse(JSON.stringify(buildTestAccount('2026-10-15', new Date('2026-10-15T08:00:00Z'))));
call('account.load', JSON.stringify({ json: JSON.stringify(account) }));
const reply = JSON.parse(call('holdings.view', JSON.stringify({ scope: 'all' })));
if (!reply.ok) throw new Error(reply.error);
writeFileSync(new URL('holdings-view.json', dir), `${JSON.stringify(reply.value, null, 2)}\n`);
console.log(`holdings-view.json: ${reply.value.rows.length} rows, ${reply.value.soldOut.length} sold out`);
