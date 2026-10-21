import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestAccount } from '../lib/test-seed/account.ts';
import { today } from '../lib/portfolio.ts';
import { dashboardPortfolio, normalizeAccount, ALL_PORTFOLIOS } from '../lib/portfolio-account.ts';
import { openPositions, safeHoldings, totals } from '../mobile/src/data/derive.ts';
import { filterBySector, sectorsOf, sortHoldings } from '../mobile/src/data/holdings-view.ts';
import { call, ENGINE_API_VERSION } from '../android/engine/src/handlers.ts';
import { unifiedPlanSource } from '../mobile/src/data/sip.ts';

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
    const planSource = scope === ALL_PORTFOLIOS && reference.portfolios.length > 1 ? unifiedPlanSource(reference).portfolio : portfolio;
    assert.deepEqual(view.value.actions, roundTrip(nextActions(portfolio, held, '2026-10', today(), 3, { planSource, dividends: false })));
    assert.equal(view.value.actions.some((a) => a.key === 'dividend'), false);
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

test('entry.get reads back what the form needs to correct or void an entry', () => {
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const owner = account.portfolios[0];
  const trade = owner.portfolio.trades.find((t) => t.kind === 'buy' && (!t.source || t.source === 'manual'));
  const got = run('entry.get', { id: `${owner.id}::${trade.id}` }).value;
  assert.equal(got.found, true);
  assert.equal(got.entryKind, 'trade');
  assert.equal(got.ticker, trade.ticker);
  assert.equal(got.shares, String(trade.shares));
  assert.equal(got.readOnly, null);
  const imported = account.portfolios.flatMap((x) => x.portfolio.trades.map((t) => ({ x, t }))).find(({ t }) => t.source && t.source !== 'manual');
  if (imported) assert.match(run('entry.get', { id: `${imported.x.id}::${imported.t.id}` }).value.readOnly, /can't be edited|statement imports/);
  const dividend = owner.portfolio.dividends?.find((d) => d.source === 'manual');
  if (dividend) assert.equal(run('entry.get', { id: `${owner.id}::${dividend.id}` }).value.entryKind, 'dividend');
  assert.equal(run('entry.get', { id: 'ahl-core::nope' }).value.found, false);
  const edited = run('mutate', { portfolio: owner.id, op: 'trade', params: JSON.stringify({ editingId: trade.id, kind: 'buy', ticker: trade.ticker, date: trade.date, shares: String(trade.shares + 1), price: String(trade.price), fees: '', month: trade.month, note: '' }) });
  assert.equal(edited.ok, true, edited.error);
  const voided = run('mutate', { portfolio: owner.id, op: 'void', params: JSON.stringify({ entryKind: 'trade', id: trade.id }) });
  assert.equal(JSON.parse(voided.value.account).portfolios[0].portfolio.trades.find((t) => t.id === trade.id).voided, true);
});

test('scope.list names every portfolio and what it holds', async () => {
  const { contentsLabel, portfolioContents } = await import('../mobile/src/data/scope.ts');
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const reference = normalizeAccount(seed(), false);
  const list = run('scope.list').value.portfolios;
  assert.deepEqual(list.map((x) => x.id), reference.portfolios.map((x) => x.id));
  assert.deepEqual(list.map((x) => x.contents), reference.portfolios.map((x) => contentsLabel(portfolioContents(x.portfolio))));
});

test('the tax status is read and changed for the whole account', () => {
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const before = run('settings.view').value.filerStatus;
  const next = before === 'filer' ? 'non-filer' : 'filer';
  const changed = run('mutate.account', { op: 'tax', params: JSON.stringify({ filerStatus: next }) });
  assert.equal(changed.ok, true, changed.error);
  const saved = JSON.parse(changed.value.account);
  assert.ok(saved.portfolios.every((p) => p.portfolio.taxProfile.filerStatus === next));
  assert.equal(run('mutate.account', { op: 'tax', params: JSON.stringify({ filerStatus: 'x' }) }).ok, false);
  assert.equal(run('mutate.account', { op: 'nope' }).ok, false);
});

test('public data is laid over the stored ledger for display only', () => {
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const wanted = run('public.wanted').value;
  assert.ok(wanted.tickers.length > 0);
  const holding = run('holdings.view', { scope: 'all' }).value.rows.find((r) => r.price !== null);
  const row = { ticker: holding.ticker, price: holding.price + 10, as_of: '2099-01-01T10:00:00Z', quote_date: holding.priceDate, source: 'https://dps.psx.com.pk/test', fetched_at: '2099-01-01T10:00:00Z' };
  assert.equal(run('public.reset').ok, true);
  assert.equal(run('public.add', { json: JSON.stringify({ quoteRows: [row], announcements: [], faceValues: {} }) }).ok, true);
  const after = run('holdings.view', { scope: 'all' }).value.rows.find((r) => r.ticker === holding.ticker);
  assert.equal(after.price, holding.price + 10);
  // A change starts from the stored account, so the cached price is not written into the vault.
  const owner = account.portfolios.find((x) => x.portfolio.companies.some((c) => c.ticker === holding.ticker));
  const changed = run('mutate', { portfolio: owner.id, op: 'budget', params: JSON.stringify({ month: '2026-12', amount: '1' }) });
  assert.equal(changed.ok, true, changed.error);
  const quote = JSON.parse(changed.value.account).portfolios.find((x) => x.id === owner.id).portfolio.quotes[holding.ticker];
  assert.notEqual(quote?.fetchedAt, '2099-01-01T10:00:00Z');
  assert.equal(run('dividends.sync').ok, true);
  run('account.unload');
  run('account.load', { json: JSON.stringify(account) });
  assert.equal(run('holdings.view', { scope: 'all' }).value.rows.find((r) => r.ticker === holding.ticker).price, holding.price);
});

test('the readable export carries the whole account', () => {
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const out = run('backup.readable').value;
  assert.equal(out.ok, true);
  assert.match(out.title, /^sipwise-all-portfolios-\d{4}-\d{2}-\d{2}\.json$/);
  const doc = JSON.parse(out.text);
  assert.equal(doc.kind, 'sipwise-portfolio-account-backup');
  assert.equal(doc.account.portfolios.length, account.portfolios.length);
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

test('a new company is added in the same save as its first entry', () => {
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const portfolioId = account.portfolios[0].id;
  const quote = { price: 50, asOf: `${today()}T10:00:00Z`, date: today(), source: 'https://dps.psx.com.pk/company/ZZTEST', fetchedAt: `${today()}T10:00:00Z` };
  const newCompany = { ticker: 'ZZTEST', name: 'Zz Test Ltd', sector: 'Others', quote };
  const trade = { ticker: 'ZZTEST', kind: 'buy', date: today(), shares: '10', price: '50', fees: '0', month: '', note: '' };
  const done = run('mutate', { portfolio: portfolioId, op: 'trade', params: JSON.stringify({ ...trade, newCompany }) });
  assert.equal(done.ok, true, done.error);
  const next = JSON.parse(done.value.account).portfolios[0].portfolio;
  assert.ok(next.companies.some((c) => c.ticker === 'ZZTEST' && c.name === 'Zz Test Ltd' && c.target === 0));
  assert.ok(next.trades.some((t) => t.ticker === 'ZZTEST'));
  const existing = account.portfolios[0].portfolio.companies[0].ticker;
  const dup = run('mutate', { portfolio: portfolioId, op: 'trade', params: JSON.stringify({ ...trade, ticker: existing, newCompany: { ...newCompany, ticker: existing } }) });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /already in your portfolio/);
  assert.ok(run('entry.options', {}).value.sectors.includes('Others'));
});

test('portfolios can be added, renamed, locked and removed (only empty unlocked ones)', () => {
  run('account.load', { json: JSON.stringify(seed()) });
  const before = run('scope.list').value.portfolios;
  const added = run('mutate.account', { op: 'portfolio.add', params: JSON.stringify({ id: 'new-one', name: '  Goal fund ' }) });
  assert.equal(added.ok, true, added.error);
  const account = JSON.parse(added.value.account);
  assert.equal(account.portfolios.length, before.length + 1);
  assert.equal(account.portfolios.at(-1).name, 'Goal fund');
  run('account.load', { json: added.value.account });
  const listed = run('scope.list').value.portfolios;
  assert.equal(listed.find((x) => x.id === 'new-one').canDelete, true);
  assert.ok(listed.some((x) => !x.canDelete), 'a portfolio with records cannot be deleted');
  const renamed = JSON.parse(run('mutate.account', { op: 'portfolio.rename', params: JSON.stringify({ id: 'new-one', name: 'Renamed' }) }).value.account);
  assert.equal(renamed.portfolios.at(-1).name, 'Renamed');
  const locked = JSON.parse(run('mutate.account', { op: 'portfolio.lock', params: JSON.stringify({ id: 'new-one', locked: true }) }).value.account);
  assert.equal(locked.portfolios.at(-1).locked, true);
  const removed = JSON.parse(run('mutate.account', { op: 'portfolio.remove', params: JSON.stringify({ id: 'new-one' }) }).value.account);
  assert.equal(removed.portfolios.length, before.length);
});

test('overview and assets views cover every portfolio and every asset class', () => {
  run('account.load', { json: JSON.stringify(seed()) });
  run('rates.set', { metals: JSON.stringify([]), navs: JSON.stringify([]) });
  const overview = run('overview.view', { scope: 'all' });
  assert.equal(overview.ok, true, overview.error);
  assert.ok(overview.value.total.value > 0);
  assert.ok(overview.value.classes.length >= 1);
  assert.ok(overview.value.portfolios.length >= 2);
  const assets = run('assets.view', { scope: 'all' });
  assert.equal(assets.ok, true, assets.error);
  assert.ok(Array.isArray(assets.value.metals) && Array.isArray(assets.value.funds) && Array.isArray(assets.value.plans));
  assert.ok(assets.value.metals.length + assets.value.funds.length + assets.value.plans.length > 0, 'the seed holds other assets');
  const wanted = run('rates.wanted').value;
  assert.equal(typeof wanted.metals, 'boolean');
});

test('monthly picks: stale check, inputs, run and view round-trip on the device', async () => {
  const { createD1 } = await import('./helpers/d1.mjs');
  const { buildPublicAnalysis } = await import('../lib/public-analysis.ts');
  const day = today();
  const q = (period, eps) => ({ period, revenue: null, pat: null, eps });
  const facts = (ticker) => ({
    ticker, name: `${ticker} Ltd`, sector: 'CEMENT', price: 100, priceDate: day, peTtm: 8,
    week52: { low: 50, high: 150 }, change1y: 20, changeYtd: 5, marketCapThousands: 1, freeFloatPct: 20,
    annual: [q('2026', 16), q('2025', 8)], quarterly: [q('Q3 2026', 5), q('Q2 2026', 4), q('Q1 2026', 3), q('Q4 2025', 2), q('Q3 2025', 1)],
    ratios: { grossMargin: [], netMargin: [], epsGrowth: [], peg: [] }, announcements: [],
    source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt: `${day}T10:00:00Z`,
  });
  run('account.load', { json: JSON.stringify(seed()) });
  const month = day.slice(0, 7);
  const view = run('picks.view', { month });
  assert.equal(view.ok, true, view.error);
  assert.ok(view.value.companies.length >= 2);
  const shortlist = view.value.companies.slice(0, 2).map((c) => c.ticker);
  const db = createD1();
  for (const ticker of shortlist)
    await db.prepare('INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES (?,?,?,?)').bind(ticker, day, JSON.stringify(facts(ticker)), `${day}T10:00:00Z`).run();
  const analysis = JSON.stringify({ ...(await buildPublicAnalysis(db, shortlist)), dispatchEnabled: true });
  const stale = run('picks.stale', { json: analysis });
  assert.equal(stale.ok, true, stale.error);
  assert.deepEqual(stale.value.stale, []);
  assert.equal(stale.value.dispatchEnabled, true);
  assert.equal(run('picks.stale', { json: '{"nope":1}' }).ok, false);
  const saved = run('mutate', { portfolio: view.value.portfolioId, op: 'picksInputs', params: JSON.stringify({ month, amount: '100000', shortlist }) });
  assert.equal(saved.ok, true, saved.error);
  run('account.load', { json: saved.value.account });
  const ran = run('mutate', { portfolio: view.value.portfolioId, op: 'picksRun', params: JSON.stringify({ month, amount: '100000', feePct: '0', shortlist, analysis }) });
  assert.equal(ran.ok, true, ran.error);
  run('account.load', { json: ran.value.account });
  const after = run('picks.view', { month });
  assert.equal(after.ok, true, after.error);
  assert.deepEqual(after.value.shortlist, shortlist);
  assert.equal(after.value.budget, 100000);
  assert.equal(after.value.run.status, 'completed');
  assert.equal(after.value.estimateError, null);
  assert.ok(Array.isArray(after.value.picks));
  assert.equal(run('picks.config').value.max, 15);
});

test('inbox view and changes spread over every portfolio', () => {
  const account = seed();
  const [first, second] = account.portfolios;
  first.portfolio.notifications = [{ id: 'ann:1:cash', at: '2026-10-10T08:00:00Z', kind: 'payout-announced', ticker: 'MEBL', title: 'MEBL dividend', body: 'Cash dividend', read: false }];
  second.portfolio.notifications = [{ id: 'div:9', at: '2026-10-11T08:00:00Z', kind: 'dividend-recorded', title: 'Second alert', body: '', read: false }];
  run('account.load', { json: JSON.stringify(account) });
  const view = run('inbox.view', { scope: 'all', filter: 'inbox' });
  assert.equal(view.ok, true, view.error);
  assert.equal(view.value.counts.inbox, 2);
  assert.equal(view.value.items[0].from, second.name);
  const cleared = run('mutate.account', { op: 'inbox', params: JSON.stringify({ scope: 'all', action: 'clearAll' }) });
  assert.equal(cleared.ok, true, cleared.error);
  const next = JSON.parse(cleared.value.account);
  assert.ok(next.portfolios[0].portfolio.notifications[0].clearedAt);
  assert.equal(next.portfolios[0].portfolio.notifications[0].id, 'ann:1:cash');
  run('account.load', { json: cleared.value.account });
  assert.equal(run('inbox.view', { scope: 'all', filter: 'cleared' }).value.items.length, 2);
  assert.equal(run('mutate.account', { op: 'inbox', params: JSON.stringify({ scope: 'all', action: 'nope' }) }).ok, false);
});

test('insights and track record views work from the shared report and performance code', () => {
  run('account.load', { json: JSON.stringify(seed()) });
  const insights = run('insights.view', { scope: 'all' });
  assert.equal(insights.ok, true, insights.error);
  assert.ok(insights.value.companyAllocation.length > 0);
  assert.ok(insights.value.summary.pricedValue > 0);
  const batches = run('track.batches', { scope: 'all' });
  assert.equal(batches.ok, true, batches.error);
  assert.equal(batches.value.empty, false);
  assert.equal(batches.value.batches[0][0], 'KSE100');
  const view = run('track.view', { scope: 'all', range: '1y', histories: JSON.stringify({}) });
  assert.equal(view.ok, true, view.error);
  assert.ok(['chart', 'empty'].includes(view.value.value.kind));
  assert.ok(['chart', 'unavailable'].includes(view.value.benchmark.kind));
});

test("today's move uses each price against the close before it, and upcoming dividends list expected payouts", () => {
  const account = seed();
  assert.equal(run('account.load', { json: JSON.stringify(account) }).ok, true);
  const reference = normalizeAccount(seed(), false);
  const portfolio = dashboardPortfolio(reference, ALL_PORTFOLIOS);
  const { held } = safeHoldings(portfolio);
  const open = openPositions(held).filter((h) => h.quote);
  assert.ok(open.length > 0);
  const histories = {};
  for (const h of open) {
    const [y, m, d] = h.quote.date.split('-').map(Number);
    const before = Date.UTC(y, m - 1, d - 1) / 1000;
    histories[h.ticker] = [[before, h.quote.price / 2]];
  }
  const move = run('today.move', { scope: 'all', histories: JSON.stringify(histories) }).value;
  assert.equal(move.available, true);
  assert.ok(move.amount > 0 && move.percent > 0);
  assert.equal(move.loser, null);
  assert.ok(move.gainer.percent > 0);
  assert.equal(run('today.move', { scope: 'all', histories: '{}' }).value.available, false);
  const view = run('today.view', { scope: 'all', month: '2026-10' }).value;
  assert.ok(Array.isArray(view.upcoming) && view.upcoming.length <= 3);
});

test('foreign currency holdings are valued from the public rates and requested only when held', () => {
  const account = seed();
  const dropCurrency = (a) => {
    for (const part of a.portfolios) part.portfolio.assets = (part.portfolio.assets ?? []).filter((x) => x.kind !== 'currency');
    return a;
  };
  const day = today();
  dropCurrency(account);
  account.portfolios[0].portfolio.assets = [
    ...(account.portfolios[0].portfolio.assets ?? []),
    { id: 'usd-test', kind: 'currency', name: 'Dollars', currency: 'USD', note: '', entries: [{ id: 'e1', date: '2026-01-01', type: 'buy', units: 100, pkr: 28000, note: '' }] },
  ];
  run('account.load', { json: JSON.stringify(account) });
  assert.equal(run('rates.wanted').value.fx, true);
  run('rates.set', { fx: JSON.stringify([{ date: day, currency: 'USD', kind: 'open_market', pkrPerUnit: 282, sourceUrl: 'x', fetchedAt: 'x' }]) });
  const view = run('assets.view', { scope: 'all' });
  assert.equal(view.ok, true, view.error);
  const row = view.value.currencies.find((c) => c.id === 'usd-test');
  assert.equal(row.value, 28200);
  assert.equal(row.gain, 200);
  assert.equal(row.rate.kind, 'open_market');
  const overview = run('overview.view', { scope: 'all' });
  assert.ok(overview.value.classes.some((c) => c.key === 'currency' && c.value >= 28200));
  run('account.load', { json: JSON.stringify(dropCurrency(seed())) });
  assert.equal(run('rates.wanted').value.fx, false);
});

test('the company view adds the weight, realised profit, payments and chart markers the web page shows', async () => {
  const { dividendPayments, realisedProfit, tradeMarkers, weightInStocks } = await import('../lib/company-view.ts');
  const { money } = await import('../lib/portfolio.ts');
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const reference = normalizeAccount(seed(), false);
  const portfolio = dashboardPortfolio(reference, ALL_PORTFOLIOS);
  const { held } = safeHoldings(portfolio);
  const h = held.find((x) => x.shares > 0);
  const view = run('company.view', { scope: ALL_PORTFOLIOS, ticker: h.ticker }).value;
  assert.equal(view.held, true);
  assert.deepEqual(view.weight, roundTrip(weightInStocks(portfolio, h.value)));
  assert.deepEqual(view.realisedProfit, roundTrip(realisedProfit(portfolio, h.ticker)));
  assert.deepEqual(view.payments, roundTrip(dividendPayments(portfolio, h.ticker)));
  assert.deepEqual(view.markers, roundTrip(tradeMarkers(portfolio.trades, h.ticker, 0, Number.MAX_SAFE_INTEGER, money)));
  // Every marker is a buy or a sale with a price, so the chart never draws an opening with no price.
  for (const m of view.markers) {
    assert.ok(m.kind === 'buy' || m.kind === 'sell');
    assert.ok(Number.isFinite(m.y) && m.y > 0);
  }
});

test('company.stats formats the key statistics exactly as the web card does', async () => {
  const { keyStats, formatStat } = await import('../lib/company-stats.ts');
  const { faceValueFor } = await import('../lib/face-values.ts');
  const { parseEod, parseIntraday } = await import('../lib/price-history.ts');
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const ticker = run('holdings.view', { scope: 'all' }).value.rows[0].ticker;
  const day = 86_400;
  const eod = Array.from({ length: 300 }, (_, i) => [1_700_000_000 + i * day, 100 + (i % 37)]);
  const stats = {
    ticker,
    peTtm: 12.5,
    marketCap: 48_000_000_000,
    week52Low: null,
    week52High: null,
    payouts: [{ kind: 'dividend', percent: 40, perShareRs: null, bookClosureStart: '2026-04-10' }],
    faceValues: [{ date: '2020-01-01', faceValue: 10, source: 'https://dps.psx.com.pk/', status: 'verified' }],
  };
  const quote = { price: 120, previousClose: 118, open: 119, high: 121, low: 117, volume: 450_000 };
  const got = run('company.stats', {
    ticker,
    stats: JSON.stringify({ stats }),
    day: JSON.stringify(quote),
    history: JSON.stringify({ eod, intraday: [] }),
  });
  assert.equal(got.ok, true, got.error);
  const company = normalizeAccount(seed(), false)
    .portfolios.flatMap((x) => x.portfolio.companies)
    .find((c) => c.ticker === ticker && !c.faceValueAssumed);
  const expected = keyStats({
    stats,
    day: quote,
    eod: parseEod(eod),
    intraday: parseIntraday([]),
    company,
    faceValueAt: faceValueFor,
    todayIso: today(),
  });
  const rows = (list) => list.map((row) => ({ label: row.label, value: formatStat(row) }));
  assert.deepEqual(got.value.left, rows(expected.left));
  assert.deepEqual(got.value.right, rows(expected.right));
  // Nothing is invented: a statistic with no evidence prints an em dash.
  assert.ok([...got.value.left, ...got.value.right].every((r) => typeof r.value === 'string' && r.value.length > 0));
});

test('every chart range the Android company page offers comes back from the shared slicer', async () => {
  const { parseEod, parseIntraday, sliceRange, rangeChange } = await import('../lib/price-history.ts');
  const day = 86_400;
  const eod = Array.from({ length: 2000 }, (_, i) => [1_600_000_000 + i * day, 100 + (i % 53)]);
  const json = JSON.stringify({ eod, intraday: [] });
  for (const range of ['today', '7d', '1m', '3m', '6m', '1y', '3y', '5y']) {
    const got = run('history.series', { json, range });
    assert.equal(got.ok, true, `${range}: ${got.error}`);
    const expected = sliceRange(parseEod(eod), parseIntraday([]), range);
    assert.deepEqual(got.value.points, roundTrip(expected), `points for ${range}`);
    assert.deepEqual(got.value.change, roundTrip(rangeChange(expected)), `change for ${range}`);
  }
});

test('sip.view matches the shared sipView, and opens the wizard when there is no plan yet', async () => {
  const { sipView } = await import('../lib/sip-blueprint-data.ts');
  const { accountSipBlueprint, setAccountSipBlueprint } = await import('../lib/portfolio-account.ts');
  const asOf = today();
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  run('rates.set', { metals: '[]', navs: '[]', fx: '[]' });
  const reference = normalizeAccount(seed(), false);
  const b = accountSipBlueprint(reference);
  assert.ok(b, 'the test seed carries a blueprint');
  const got = run('sip.view', { asOf });
  assert.equal(got.ok, true, got.error);
  assert.equal(got.value.setup, false);
  const expected = sipView(b, reference.portfolios, asOf, {}, { canLog: reference.portfolios.some((p) => !p.locked) });
  assert.deepEqual(got.value.hero, roundTrip(expected.hero));
  assert.deepEqual(got.value.rows, roundTrip(expected.rows));
  assert.deepEqual(got.value.state, roundTrip(expected.state));
  assert.equal(got.value.day, expected.day);
  assert.equal(got.value.strict, expected.strict);
  // Rows only ever ask for one of the four actions the phone knows how to carry out.
  for (const row of got.value.rows) assert.ok(['picks', 'holdings', 'log', 'mark'].includes(row.action), row.action);

  run('account.load', { json: JSON.stringify(setAccountSipBlueprint(normalizeAccount(seed(), false), null)) });
  const wizard = run('sip.view', { asOf }).value;
  assert.equal(wizard.setup, true);
  assert.equal(wizard.presets.length, 4);
  assert.ok(wizard.presets.every((p) => p.annual > 0 || p.key === 'custom'));
  assert.ok(wizard.budgetPills.length > 0);
  assert.ok(wizard.blank.budget > 0);
});

test('sip.preview, sip.project and sip.rebalance answer the drafts the sheets show', async () => {
  const { blendedReturn, planMonth, projectSip, mixAfter, rebalanceEdit, targetsTotal, DEFAULT_RETURNS, SIP_CLASSES } =
    await import('../lib/sip-blueprint.ts');
  const { classWeights, LONG_RUN_INFLATION } = await import('../lib/sip-blueprint-data.ts');
  const { accountSipBlueprint } = await import('../lib/portfolio-account.ts');
  const asOf = today();
  run('account.load', { json: JSON.stringify(seed()) });
  run('rates.set', { metals: '[]', navs: '[]', fx: '[]' });
  const reference = normalizeAccount(seed(), false);
  const b = accountSipBlueprint(reference);

  const draft = { budget: 60_000, targets: { stocks: 50, funds: 30, gold: 15, currency: 5 }, strict: true };
  const preview = run('sip.preview', { asOf, draft: JSON.stringify(draft) });
  assert.equal(preview.ok, true, preview.error);
  const held = classWeights(reference.portfolios, asOf, {});
  const plan = planMonth(draft.budget, draft.targets, held.weights, true);
  assert.deepEqual(preview.value.plan, roundTrip(plan));
  assert.equal(preview.value.total, targetsTotal(draft.targets));
  assert.equal(preview.value.valid, true);
  assert.equal(preview.value.annual, blendedReturn(draft.targets));
  assert.deepEqual(preview.value.mix, roundTrip(mixAfter(held.values, plan)));
  assert.ok(preview.value.in10.value > preview.value.in10.invested);
  // A split that does not add up to 100 is not offered as a plan to save.
  assert.equal(run('sip.preview', { asOf, draft: JSON.stringify({ ...draft, targets: { ...draft.targets, gold: 40 } }) }).value.valid, false);

  const projection = run('sip.project', { monthly: '50000', years: '15', stepUp: '10' });
  assert.equal(projection.ok, true, projection.error);
  const annual = blendedReturn(b.targets, { ...DEFAULT_RETURNS, ...b.returns });
  const points = projectSip({ monthly: 50_000, years: 15, annualPct: annual, stepUpPct: 10, inflationPct: LONG_RUN_INFLATION });
  assert.deepEqual(projection.value.points, roundTrip(points));
  assert.equal(projection.value.annual, annual);
  assert.equal(projection.value.last.year, 15);
  // Today's money is always the smaller of the two, and every milestone carries its words.
  assert.ok(projection.value.last.realValue < projection.value.last.value);
  assert.ok(projection.value.marks.nominal.every((m) => typeof m.label === 'string' && m.label.startsWith('Rs')));
  assert.ok(projection.value.skip.real < projection.value.skip.nominal);

  const state = run('sip.view', { asOf }).value.state;
  const moved = run('sip.rebalance', { asOf, class: 'gold', amount: String(state.plan.gold + 2_000) });
  assert.equal(moved.ok, true, moved.error);
  const locked = SIP_CLASSES.filter((k) => state.done[k]);
  assert.deepEqual(moved.value.plan, roundTrip(rebalanceEdit(state.plan, 'gold', state.plan.gold + 2_000, state.budget, b.targets, locked)));
  assert.deepEqual(moved.value.locked, locked);
  assert.equal(run('sip.rebalance', { asOf, class: 'nope', amount: '1' }).ok, false);
  assert.equal(run('sip.rebalance', { asOf, class: 'gold', amount: '-1' }).ok, false);
});

test('SIP blueprint changes go through mutate.account and return the next account unsaved', async () => {
  const { accountSipBlueprint } = await import('../lib/portfolio-account.ts');
  const asOf = today();
  const month = asOf.slice(0, 7);
  run('account.load', { json: JSON.stringify(seed()) });
  const before = accountSipBlueprint(normalizeAccount(seed(), false));

  const ticked = run('mutate.account', {
    op: 'sip.done',
    params: JSON.stringify({ month, class: 'gold', amount: '5000', date: asOf }),
  });
  assert.equal(ticked.ok, true, ticked.error);
  const next = accountSipBlueprint(JSON.parse(ticked.value.account));
  assert.deepEqual(next.months[month].done.gold, { amount: 5000, date: asOf });
  // The loaded account is untouched until the app saves and loads it back.
  assert.deepEqual(accountSipBlueprint(normalizeAccount(seed(), false)).months[month]?.done?.gold, before.months[month]?.done?.gold);

  const untick = run('mutate.account', { op: 'sip.undone', params: JSON.stringify({ month, class: 'gold' }) });
  assert.equal(untick.ok, true, untick.error);
  assert.equal(accountSipBlueprint(JSON.parse(untick.value.account)).months[month].done.gold, undefined);

  const notify = run('mutate.account', { op: 'sip.notify', params: JSON.stringify({ month, notify: true }) });
  assert.equal(accountSipBlueprint(JSON.parse(notify.value.account)).notify, true);

  const cleared = run('mutate.account', { op: 'sip.clear', params: '{}' });
  assert.equal(cleared.ok, true, cleared.error);
  assert.equal(accountSipBlueprint(JSON.parse(cleared.value.account)), null);

  // A bad change is refused with the same wording the person reads on the web.
  assert.match(run('mutate.account', { op: 'sip.done', params: JSON.stringify({ month, class: 'gold', amount: '5000', date: 'nope' }) }).error, /YYYY-MM-DD/);
  assert.equal(run('mutate.account', { op: 'sip.nope', params: JSON.stringify({ month }) }).ok, false);
});

test('a gold or currency purchase logged from the SIP Blueprint lands in the ledger as an asset entry', () => {
  const asOf = today();
  const account = seed();
  run('account.load', { json: JSON.stringify(account) });
  const owner = account.portfolios.find((p) => !p.locked);
  const logged = run('mutate', {
    portfolio: owner.id,
    op: 'sip.log',
    params: JSON.stringify({ class: 'gold', date: asOf, amount: '20000', grams: '5.8' }),
  });
  assert.equal(logged.ok, true, logged.error);
  const assets = JSON.parse(logged.value.account).portfolios.find((p) => p.id === owner.id).portfolio.assets ?? [];
  const metal = assets.filter((a) => a.kind === 'metal');
  assert.ok(metal.some((a) => a.entries.some((e) => e.date === asOf && e.amount === 20000)));
  assert.equal(run('mutate', { portfolio: owner.id, op: 'sip.log', params: JSON.stringify({ class: 'gold', date: asOf, amount: '0', grams: '5.8' }) }).ok, false);
});
