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
const companyTicker = account.portfolios[0].portfolio.trades[0].ticker;
for (const [file, name, args] of [
  ['holdings-view.json', 'holdings.view', { scope: 'all' }],
  ['today-view.json', 'today.view', { scope: 'all', month: '2026-10' }],
  ['plan-view.json', 'plan.view', { month: '2026-10', feePct: '0', allowOld: 'true' }],
  ['company-view.json', 'company.view', { scope: 'all', ticker: companyTicker }],
  ['overview.json', 'overview.view', { scope: 'all' }],
  ['assets.json', 'assets.view', { scope: 'all' }],
  ['picks-view.json', 'picks.view', { month: '2026-10' }],
  ['activity-view.json', 'activity.view', { scope: 'all', filter: 'all', query: '' }],
]) {
  const reply = JSON.parse(call(name, JSON.stringify(args)));
  if (!reply.ok) throw new Error(`${name}: ${reply.error}`);
  writeFileSync(new URL(file, dir), `${JSON.stringify(reply.value, null, 2)}\n`);
  console.log(`${file} written`);
}
