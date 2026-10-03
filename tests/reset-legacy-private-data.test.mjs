import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTarget, parseArgs, plan, RESET_TABLES } from '../scripts/reset-legacy-private-data.mjs';

const PROD = 'f72a6264-371b-49ff-89e3-20eef1ce2b19';
const STAGING = 'f4ee7f4b-bfe7-4dc3-95ab-475917aee59b';

test('defaults to a dry run and needs an explicit database id and target', () => {
  const options = parseArgs(['--target=staging']);
  assert.equal(options.execute, false);
  assert.throws(() => checkTarget(options, undefined), /no default/);
  assert.throws(() => checkTarget(parseArgs([]), STAGING), /--target/);
  assert.deepEqual(checkTarget(options, STAGING), { id: STAGING, isProduction: false });
});

test('refuses a target that disagrees with the database id', () => {
  assert.throws(() => checkTarget(parseArgs(['--target=production']), STAGING), /not the production/);
  assert.throws(() => checkTarget(parseArgs(['--target=staging']), PROD), /is the production/);
});

test('executing needs the first 8 characters of the id as confirmation', () => {
  assert.throws(() => checkTarget(parseArgs(['--target=production', '--execute']), PROD), /--confirm=f72a6264/);
  assert.throws(() => checkTarget(parseArgs(['--target=production', '--execute', '--confirm=nope']), PROD), /--confirm/);
  assert.equal(checkTarget(parseArgs(['--target=production', '--execute', '--confirm=f72a6264']), PROD).isProduction, true);
});

test('clears only private legacy tables; sessions only when asked; public tables never', () => {
  const names = plan(parseArgs([])).map((table) => table.name);
  assert.deepEqual(names.sort(), RESET_TABLES.map((table) => table.name).sort());
  assert.ok(!names.includes('mobile_sessions'));
  assert.ok(plan(parseArgs(['--revoke-sessions'])).some((table) => table.name === 'mobile_sessions'));
  for (const kept of ['quote_refreshes', 'company_facts', 'price_history', 'user_roles', 'security_catalog', 'dividend_announcements', 'ai_usage'])
    assert.ok(!names.includes(kept), kept);
});
