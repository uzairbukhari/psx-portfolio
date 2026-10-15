import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestAccount } from '../lib/test-seed/account.ts';
import { today } from '../lib/portfolio.ts';
import { dashboardPortfolio, normalizeAccount, ALL_PORTFOLIOS } from '../lib/portfolio-account.ts';
import { safeHoldings, totals } from '../mobile/src/data/derive.ts';
import { call, ENGINE_API_VERSION } from '../android/engine/src/handlers.ts';

// Built once: the seed stamps some fields with the current time.
const BASE = JSON.parse(JSON.stringify(buildTestAccount(today())));
const seed = () => JSON.parse(JSON.stringify(BASE));
const run = (name, args = {}) => JSON.parse(call(name, JSON.stringify(args)));
const roundTrip = (value) => JSON.parse(JSON.stringify(value));

test('engine reports its API version and rejects unknown calls without throwing', () => {
  assert.equal(run('engine.version').value, ENGINE_API_VERSION);
  const unknown = run('nope');
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /Unknown engine call/);
});

test('blank account and normalize match the shared account rules', () => {
  const blank = run('account.blank');
  assert.equal(blank.ok, true);
  assert.equal(run('account.normalize', { json: JSON.stringify(blank.value) }).ok, true);
  const bad = run('account.normalize', { json: '{"nope":1}' });
  assert.equal(bad.ok, false);
});

test('holdings and totals for the test account equal what the Expo app computes, for every scope', () => {
  const account = seed();
  assert.equal(run('account.load', { json: JSON.stringify(account) }).ok, true);
  const reference = normalizeAccount(seed(), false);
  const scopes = [ALL_PORTFOLIOS, ...account.portfolios.map((p) => p.id)];
  for (const scope of scopes) {
    const expected = safeHoldings(dashboardPortfolio(reference, scope));
    const got = run('holdings.snapshot', { scope });
    assert.equal(got.ok, true, got.error);
    assert.deepEqual(got.value.held, roundTrip(expected.held), `held, scope ${scope}`);
    assert.deepEqual(got.value.totals, roundTrip(totals(expected.held)), `totals, scope ${scope}`);
  }
});

test('a locked portfolio cannot be edited through the writable check', () => {
  const account = seed();
  account.portfolios[0].locked = true;
  const changed = seed();
  changed.portfolios[0].locked = true;
  changed.portfolios[0].portfolio.notes = 'edited';
  const result = run('account.assertWritable', { current: JSON.stringify(account), next: JSON.stringify(changed) });
  assert.equal(result.ok, false);
  assert.equal(run('account.assertWritable', { current: JSON.stringify(account), next: JSON.stringify(account) }).ok, true);
});
