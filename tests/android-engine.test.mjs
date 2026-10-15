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

test('the company view and history series match the Expo helpers', async () => {
  const { companyDividends, activityEntries } = await import('../mobile/src/data/derive.ts');
  const { parseEod, parseIntraday, sliceRange, rangeChange } = await import('../lib/price-history.ts');
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const reference = normalizeAccount(seed(), false);
  const portfolio = dashboardPortfolio(reference, ALL_PORTFOLIOS);
  const { held } = safeHoldings(portfolio);
  const h = held.find((x) => x.shares > 0);
  const view = run('company.view', { scope: ALL_PORTFOLIOS, ticker: h.ticker.toLowerCase() });
  assert.equal(view.ok, true, view.error);
  assert.equal(view.value.found, true);
  assert.equal(view.value.shares, h.shares);
  assert.deepEqual(view.value.dividends, roundTrip(companyDividends(portfolio, h.ticker)));
  assert.deepEqual(view.value.entries, roundTrip(activityEntries(portfolio, h.ticker)));
  assert.equal(run('company.view', { scope: ALL_PORTFOLIOS, ticker: 'NOPE' }).value.found, false);

  const day = 86400;
  const eod = Array.from({ length: 40 }, (_, i) => [1_700_000_000 + i * day, 100 + i]);
  const json = JSON.stringify({ eod, intraday: [] });
  const series = run('history.series', { json, range: '1m' });
  const expected = sliceRange(parseEod(eod), parseIntraday([]), '1m');
  assert.deepEqual(series.value.points, roundTrip(expected));
  assert.deepEqual(series.value.change, roundTrip(rangeChange(expected)));
});

test('the plan view, review totals, budget and buys match the Expo plan code', async () => {
  const { buildPlan, unifiedPlanSource, monthBuys } = await import('../mobile/src/data/sip.ts');
  const { parseReview } = await import('../mobile/src/data/record-buys.ts');
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const reference = normalizeAccount(seed(), false);
  const { portfolio } = unifiedPlanSource(reference);
  const month = '2026-10';
  const view = run('plan.view', { month, feePct: '0.5', allowOld: 'true' });
  assert.equal(view.ok, true, view.error);
  const expected = buildPlan(portfolio, month, 0.5, true);
  assert.deepEqual(view.value.plan, roundTrip(expected.plan));
  assert.deepEqual(view.value.bought, roundTrip(monthBuys(portfolio, month)));
  const rows = [{ ticker: 'AAA', name: 'A', shares: '10', price: '5' }, { ticker: 'BBB', name: 'B', shares: '1.5', price: '5' }];
  assert.deepEqual(run('buys.review', { rows: JSON.stringify(rows), feePct: '1' }).value, roundTrip(parseReview(rows, 1)));

  const typed = [{ ticker: reference.portfolios[0].portfolio.companies[0].ticker, name: 'x', shares: '3', price: '10' }];
  const viaRows = run('mutate', { portfolio: reference.portfolios[0].id, op: 'buys', params: JSON.stringify({ rows: typed, feePct: '1', month, note: 'SIP' }) });
  assert.equal(viaRows.ok, true, viaRows.error);
  const added = JSON.parse(viaRows.value.account).portfolios[0].portfolio.trades.at(-1);
  assert.equal(added.shares, 3);
  assert.equal(added.fees, 0.3);
  const badRows = run('mutate', { portfolio: reference.portfolios[0].id, op: 'buys', params: JSON.stringify({ rows: [{ ...typed[0], shares: '1.5' }], month }) });
  assert.match(badRows.error, /Fix the highlighted rows/);

  const homeId = reference.portfolios[0].id;
  const budget = run('mutate', { portfolio: homeId, op: 'budget', params: JSON.stringify({ month: '2026-11', amount: '12345' }) });
  assert.equal(budget.ok, true, budget.error);
  assert.equal(JSON.parse(budget.value.account).portfolios[0].portfolio.budgets['2026-11'], 12345);
  assert.equal(run('mutate', { portfolio: homeId, op: 'budget', params: JSON.stringify({ month: '2026-11', amount: '' }) }).ok, false);

  const other = reference.portfolios[1];
  const foreign = reference.portfolios[0].portfolio.companies.find((c) => !other.portfolio.companies.some((x) => x.ticker === c.ticker));
  if (foreign) {
    const buys = [{ ticker: foreign.ticker, shares: 5, price: 10, fees: 1 }];
    const rec = run('mutate', { portfolio: other.id, op: 'buys', params: JSON.stringify({ buys, month, note: 'SIP' }) });
    assert.equal(rec.ok, true, rec.error);
    const saved = JSON.parse(rec.value.account).portfolios[1].portfolio;
    assert.equal(saved.companies.find((c) => c.ticker === foreign.ticker).target, 0);
  }
});

test('the targets editor matches the shared target rules', async () => {
  const { targetRows, targetTotals, screenStatus, applyTargets, evenWeights } = await import('../lib/targets.ts');
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const reference = normalizeAccount(seed(), false);
  const home = reference.portfolios[0];
  const view = run('targets.view');
  assert.deepEqual(view.value.rows.map((r) => r.ticker), targetRows(home.portfolio).map((r) => r.ticker));
  const rows = view.value.rows;
  const evaluated = run('targets.eval', { rows: JSON.stringify(rows) }).value;
  assert.deepEqual(evaluated.totals, roundTrip(targetTotals(targetRows(home.portfolio))));
  assert.deepEqual(evaluated.statuses[rows[0].ticker], roundTrip(screenStatus({ approved: rows[0].approved, screenDate: rows[0].screenDate })));
  assert.deepEqual(run('targets.even', { count: '3' }).value, evenWeights(3));
  const even = evenWeights(rows.length).map(String);
  const evenRows = rows.map((r, i) => ({ ...r, weight: even[i], screenDate: '2026-09-01', approved: true }));
  const saved = run('mutate', { portfolio: home.id, op: 'targets', params: JSON.stringify({ rows: evenRows }) });
  assert.equal(saved.ok, true, saved.error);
  {
    const expected = applyTargets(home.portfolio, evenRows.map((r) => ({ ticker: r.ticker, target: Number(r.weight), approved: r.approved, screenDate: r.screenDate })));
    assert.deepEqual(JSON.parse(saved.value.account).portfolios[0].portfolio.companies.map((c) => c.target), roundTrip(expected.companies.map((c) => c.target)));
  }
  assert.equal(run('mutate', { portfolio: home.id, op: 'targets', params: JSON.stringify({ rows: [{ ...rows[0], weight: '10' }] }) }).ok, false);
  assert.equal(run('targets.search', { taken: JSON.stringify(rows.map((r) => r.ticker)), query: '' }).ok, true);
});

test('ledger changes validate like the Expo screens and return the next account without loading it', async () => {
  const { mutateAccount } = await import('../android/engine/src/mutate.ts');
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const portfolioId = account.portfolios[0].id;
  const ticker = account.portfolios[0].portfolio.companies[0].ticker;
  const before = run('holdings.view', { scope: portfolioId }).value;

  const bad = run('mutate', { portfolio: portfolioId, op: 'trade', params: JSON.stringify({ ticker, kind: 'buy', date: '2026-10-01', shares: '1.5', price: '10' }) });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /whole number of shares/);

  const params = { ticker, kind: 'buy', date: '2026-10-01', shares: '10', price: '100', fees: '5', month: '2026-10', note: 'x' };
  const good = run('mutate', { portfolio: portfolioId, op: 'trade', params: JSON.stringify(params) });
  assert.equal(good.ok, true, good.error);
  const next = JSON.parse(good.value.account);
  const reference = mutateAccount(normalizeAccount(seed(), false), portfolioId, 'trade', params);
  assert.equal(next.portfolios[0].portfolio.trades.length, reference.portfolios[0].portfolio.trades.length);
  assert.equal(next.portfolios[0].portfolio.trades.length, account.portfolios[0].portfolio.trades.length + 1);
  // The engine still shows the old ledger until the app saves and reloads.
  assert.deepEqual(run('holdings.view', { scope: portfolioId }).value, before);
  assert.equal(run('account.load', { json: good.value.account }).ok, true);

  const price = run('mutate', { portfolio: portfolioId, op: 'price', params: JSON.stringify({ ticker, price: '123.45', date: today() }) });
  assert.equal(price.ok, true, price.error);
  const unknown = run('mutate', { portfolio: portfolioId, op: 'nope' });
  assert.equal(unknown.ok, false);

  const options = run('entry.options', { query: '' });
  assert.equal(options.value.portfolios.length, account.portfolios.length);
  assert.deepEqual(run('entry.totals', { kind: 'buy', shares: '10', price: '100', fees: '5' }).value, { gross: 1000, fees: 5, total: 1005, label: 'Total cost including fees' });
  assert.equal(run('entry.totals', { kind: 'buy', shares: '', price: '100' }).value, null);
});
