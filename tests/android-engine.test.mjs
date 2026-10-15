import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestAccount } from '../lib/test-seed/account.ts';
import { today } from '../lib/portfolio.ts';
import { dashboardPortfolio, normalizeAccount, ALL_PORTFOLIOS } from '../lib/portfolio-account.ts';
import { openPositions, safeHoldings, totals } from '../mobile/src/data/derive.ts';
import { filterBySector, sectorsOf, sortHoldings } from '../mobile/src/data/holdings-view.ts';
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

test('the holdings view matches the Expo app for every scope, sort and sector', () => {
  const account = seed();
  assert.equal(run('account.load', { json: JSON.stringify(account) }).ok, true);
  const reference = normalizeAccount(seed(), false);
  const scopes = [ALL_PORTFOLIOS, ...account.portfolios.map((p) => p.id)];
  for (const scope of scopes) {
    const portfolio = dashboardPortfolio(reference, scope);
    const { held } = safeHoldings(portfolio);
    const open = openPositions(held);
    const expectedTotals = roundTrip(totals(held));
    for (const sort of ['value', 'gain', 'weight', 'name']) {
      const got = run('holdings.view', { scope, sort });
      assert.equal(got.ok, true, got.error);
      assert.deepEqual(got.value.summary, expectedTotals, `summary, scope ${scope}`);
      assert.deepEqual(
        got.value.rows.map((r) => r.ticker),
        sortHoldings(open, sort).map((h) => h.ticker),
        `order by ${sort}, scope ${scope}`,
      );
    }
    const sectors = sectorsOf(open);
    assert.deepEqual(run('holdings.view', { scope }).value.sectors, sectors);
    if (sectors[0]) {
      const filtered = run('holdings.view', { scope, sector: sectors[0] }).value.rows;
      assert.deepEqual(filtered.map((r) => r.ticker), filterBySector(sortHoldings(open, 'value'), sectors[0]).map((h) => h.ticker));
    }
    const first = run('holdings.view', { scope }).value.rows[0];
    if (first) {
      const h = open.find((x) => x.ticker === first.ticker);
      assert.equal(first.value, h.value);
      assert.equal(first.shares, h.shares);
      assert.equal(first.price, h.quote?.price ?? null);
    }
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

test('the today and activity views match the Expo view-models', async () => {
  const { activityEntries } = await import('../mobile/src/data/derive.ts');
  const { filterActivity, groupByMonth } = await import('../mobile/src/data/activity-view.ts');
  const { monthProgress, nextActions, returnBreakdown } = await import('../mobile/src/data/today.ts');
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const reference = normalizeAccount(seed(), false);
  for (const scope of [ALL_PORTFOLIOS, ...account.portfolios.map((p) => p.id)]) {
    const portfolio = dashboardPortfolio(reference, scope);
    const { held } = safeHoldings(portfolio);
    const summary = totals(held);
    const view = run('today.view', { scope, month: '2026-10' });
    assert.equal(view.ok, true, view.error);
    assert.deepEqual(view.value.breakdown, roundTrip(returnBreakdown(portfolio, summary.gain)));
    assert.deepEqual(view.value.progress, roundTrip(monthProgress(portfolio, '2026-10')));
    assert.deepEqual(view.value.actions, roundTrip(nextActions(portfolio, held, '2026-10', today())));
    for (const filter of ['all', 'buy', 'sell', 'dividend', 'split']) {
      for (const query of ['', 'a']) {
        const act = run('activity.view', { scope, filter, query });
        const expected = groupByMonth(filterActivity(activityEntries(portfolio), filter, query));
        assert.deepEqual(act.value.sections, roundTrip(expected));
      }
    }
  }
});
