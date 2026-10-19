import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestAccount } from '../lib/test-seed/account.ts';
import {
  allocationBuckets,
  benchmarkRace,
  budgetCompletion,
  concentrationAction,
  dividendTaxView,
  fundBucket,
  fundProjection,
  futureValue,
  hedgeStatus,
  incomeRunRate,
  milestones,
  moneyInEvents,
  monthlyPace,
  rcaSummary,
  sipStreak,
  trailingReturn,
} from '../lib/insights-guided.ts';
import { BENCHMARKS_AS_OF, CPI_YOY_BY_YEAR, POLICY_RATE, inflationOn, policyRateOn, savingsRateOn } from '../lib/pk-benchmarks.ts';
import { taxYearOf } from '../lib/portfolio.ts';

const TODAY = '2026-10-16';
const flow = (date, amount = 1000) => ({ date, amount });

test('streak counts consecutive months and the open month does not break it', () => {
  const flows = [flow('2026-06-03'), flow('2026-07-04'), flow('2026-08-05'), flow('2026-09-06')];
  const s = sipStreak(flows, TODAY);
  assert.equal(s.current, 4);
  assert.equal(s.thisMonthDone, false);
  assert.equal(s.longest, 4);
  assert.equal(sipStreak([...flows, flow('2026-10-02')], TODAY).current, 5);
});

test('streak resets after a missed month and tracks the longest run', () => {
  const flows = [flow('2026-01-03'), flow('2026-02-03'), flow('2026-03-03'), flow('2026-05-03'), flow('2026-09-03')];
  const s = sipStreak(flows, TODAY);
  assert.equal(s.current, 1);
  assert.equal(s.longest, 3);
  assert.equal(s.monthsActive, 5);
});

test('streak with no money in is zero and sales do not count', () => {
  assert.equal(sipStreak([], TODAY).current, 0);
  assert.equal(sipStreak([flow('2026-09-03', -500)], TODAY).monthsActive, 0);
});

test('budget completion uses only months that have a budget and caps each month', () => {
  const flows = [flow('2026-09-03', 50_000), flow('2026-10-03', 150_000)];
  const r = budgetCompletion({ '2026-09': 100_000, '2026-10': 100_000 }, flows, TODAY, 3);
  assert.equal(r.months.length, 2);
  assert.equal(r.average, 0.75);
  assert.equal(budgetCompletion({}, flows, TODAY).average, null);
});

test('fund categories map to buckets and unknown wording is flagged as assumed', () => {
  assert.deepEqual(fundBucket('Money Market'), { bucket: 'stability', assumed: false });
  assert.deepEqual(fundBucket('Equity'), { bucket: 'growth', assumed: false });
  assert.equal(fundBucket('Shariah Compliant Income').bucket, 'stability');
  assert.equal(fundBucket('Something new').assumed, true);
});

test('buckets add up to the allocation total and hold every holding once', () => {
  const account = buildTestAccount(TODAY);
  const { buckets, total } = allocationBuckets(account.portfolios, TODAY);
  assert.equal(buckets.length, 3);
  assert.equal(Math.round(buckets.reduce((n, b) => n + b.value, 0)), Math.round(total));
  assert.ok(Math.abs(buckets.reduce((n, b) => n + b.share, 0) - 100) < 1e-6);
  for (const b of buckets)
    assert.equal(Math.round(b.groups.reduce((n, g) => n + g.value, 0)), Math.round(b.value));
});

test('concentration action lists holdings over the limit and stocks that would balance them', () => {
  const r = concentrationAction([
    { name: 'MEBL', value: 50, ticker: 'MEBL' },
    { name: 'LUCK', value: 30, ticker: 'LUCK' },
    { name: 'Gold', value: 15 },
    { name: 'ENGRO', value: 5, ticker: 'ENGRO' },
  ]);
  assert.deepEqual(r.over.map((o) => o.name), ['MEBL', 'LUCK']);
  assert.deepEqual(r.under.map((o) => o.name), ['ENGRO']);
  assert.deepEqual(concentrationAction([]).over, []);
});

test('benchmark race needs money in and enough time', () => {
  assert.deepEqual(benchmarkRace({ flows: [], currentValue: 0, asOf: TODAY, index: [] }), {
    available: false,
    reason: 'no-flows',
  });
  assert.equal(
    benchmarkRace({ flows: [flow('2026-10-01')], currentValue: 1000, asOf: TODAY, index: [] }).reason,
    'too-short',
  );
});

test('benchmark race compares you with inflation, savings and the index', () => {
  const sec = (d) => Date.parse(`${d}T00:00:00Z`) / 1000 - 5 * 3600;
  const index = [
    [sec('2024-01-02'), 60_000],
    [sec('2025-01-02'), 66_000],
    [sec('2026-10-15'), 72_000],
  ];
  const flows = [flow('2024-01-02', 100_000), flow('2025-01-02', 100_000)];
  const r = benchmarkRace({ flows, currentValue: 230_000, asOf: TODAY, index });
  assert.ok(r.available);
  assert.equal(r.moneyIn, 200_000);
  const keys = r.entries.map((e) => e.key);
  assert.deepEqual(keys, ['you', 'kse100', 'inflation', 'savings']);
  const kse = r.entries.find((e) => e.key === 'kse100');
  // 100k at 60k -> 120k at 72k; 100k at 66k -> ~109.09k
  assert.ok(Math.abs(kse.endValue - (100_000 * 72 / 60 + 100_000 * 72 / 66)) < 1);
  const sav = r.entries.find((e) => e.key === 'savings');
  assert.ok(sav.endValue > 200_000);
  assert.equal(typeof r.beatsInflation, 'boolean');
});

test('benchmark race leaves the index out when its history starts late', () => {
  const sec = (d) => Date.parse(`${d}T00:00:00Z`) / 1000 - 5 * 3600;
  const r = benchmarkRace({
    flows: [flow('2020-01-02', 100_000)],
    currentValue: 150_000,
    asOf: TODAY,
    index: [[sec('2024-01-02'), 60_000]],
  });
  assert.ok(r.available);
  assert.ok(r.omitted.some((o) => o.key === 'kse100'));
  assert.ok(!r.entries.some((e) => e.key === 'kse100'));
});

test('income run-rate needs history and some income', () => {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `m${i}`, amount: i === 3 ? 12_000 : 0 }));
  assert.equal(incomeRunRate(months, '2026-09-01', TODAY).annual, null);
  assert.equal(incomeRunRate(months, null, TODAY).annual, null);
  const r = incomeRunRate(months, '2024-01-01', TODAY);
  assert.equal(r.annual, 12_000);
  assert.equal(r.monthly, 1000);
  assert.equal(incomeRunRate(months.map((m) => ({ ...m, amount: 0 })), '2024-01-01', TODAY).reason, 'none-yet');
});

test('milestones only claim what the inputs support', () => {
  const streak = { current: 4, longest: 4, monthsActive: 4, thisMonthDone: true, monthsSince: 4 };
  const none = milestones({ stabilityValue: 0, monthlyExpenses: null, incomeThisYear: 0, moneyIn: 5000, streak: { ...streak, current: 1 } });
  assert.deepEqual(none, []);
  const some = milestones({ stabilityValue: 300_000, monthlyExpenses: 100_000, incomeThisYear: 11_560, moneyIn: 600_000, streak });
  assert.ok(some.find((m) => m.key === 'emergency').text.includes('3 months'));
  assert.ok(some.find((m) => m.key === 'income-expenses'));
  assert.ok(some.find((m) => m.key === 'money-in').text.includes('500,000'));
  assert.ok(some.find((m) => m.key === 'streak'));
});

test('future value matches the annuity formula and zero growth', () => {
  assert.equal(Math.round(futureValue(0, 1000, 0, 1)), 12_000);
  const r = 0.12 / 12;
  const expected = 1000 * ((Math.pow(1 + r, 36) - 1) / r);
  assert.ok(Math.abs(futureValue(0, 1000, 12, 3) - expected) < 0.01);
  const p = fundProjection({ current: 100_000, monthly: 10_000, basePercent: 10 });
  assert.deepEqual(p.map((x) => x.years), [3, 5, 10]);
  for (const x of p) {
    assert.ok(x.low < x.base && x.base < x.high);
    assert.ok(x.low > x.contributed * 0.99);
  }
});

test('trailing return needs 90 days of history', () => {
  assert.equal(trailingReturn([{ date: '2026-09-01', nav: 100 }, { date: '2026-10-01', nav: 101 }]), null);
  const r = trailingReturn([{ date: '2025-10-01', nav: 100 }, { date: '2026-10-01', nav: 110 }]);
  assert.ok(Math.abs(r - 10) < 0.1);
});

test('monthly pace averages the last months', () => {
  const flows = [flow('2026-10-02', 6000), flow('2026-04-02', 99_999)];
  assert.equal(monthlyPace(flows, TODAY, 6), 1000);
});

test('hedge status uses the 10 to 20 percent guide', () => {
  assert.equal(hedgeStatus(4), 'below');
  assert.equal(hedgeStatus(15), 'in');
  assert.equal(hedgeStatus(35), 'above');
});

test('rupee-cost averaging counts buys made below the running average', () => {
  const t = (date, shares, price) => ({ id: date, ticker: 'MEBL', kind: 'buy', date, shares, price, fees: 0, month: date.slice(0, 7), note: '' });
  const r = rcaSummary([t('2026-01-01', 10, 200), t('2026-02-01', 10, 150), t('2026-03-01', 10, 220)], 'MEBL', 210);
  assert.equal(r.buys, 3);
  assert.equal(r.dipBuys, 1);
  assert.equal(r.low, 150);
  assert.equal(r.high, 220);
  assert.equal(Math.round(r.avgCost * 100) / 100, 190);
  assert.ok(r.vsCostPercent > 10);
  assert.equal(rcaSummary([], 'MEBL', 1), null);
});

test('dividend tax uses recorded withholding first and the filer rate otherwise', () => {
  const d = (over) => ({ id: 'x', ticker: 'MEBL', date: '2026-08-10', source: 'manual', note: '', status: 'received', ...over });
  const rows = [d({ grossAmount: 1000 }), d({ grossAmount: 1000, taxWithheld: 100 }), d({ grossAmount: 500, status: 'expected' })];
  const filer = dividendTaxView(rows, 'filer', '2026-27', taxYearOf);
  assert.equal(filer.gross, 2000);
  assert.equal(filer.tax, 250);
  assert.equal(filer.net, 1750);
  assert.equal(filer.estimated, true);
  assert.equal(dividendTaxView(rows, 'non-filer', '2026-27', taxYearOf).tax, 400);
  assert.equal(dividendTaxView(rows, null, '2026-27', taxYearOf).tax, 100);
});

test('money-in events come from stocks and other assets and are all positive', () => {
  const account = buildTestAccount(TODAY);
  const events = moneyInEvents(account.portfolios, TODAY);
  assert.ok(events.length > 0);
  assert.ok(events.every((e) => e.amount > 0 && e.date <= TODAY));
});

test('benchmark tables are sorted, in range and answer lookups', () => {
  for (let i = 1; i < POLICY_RATE.length; i++) assert.ok(POLICY_RATE[i][0] > POLICY_RATE[i - 1][0]);
  for (let i = 1; i < CPI_YOY_BY_YEAR.length; i++) assert.equal(CPI_YOY_BY_YEAR[i][0], CPI_YOY_BY_YEAR[i - 1][0] + 1);
  for (const [, v] of POLICY_RATE) assert.ok(v > 0 && v < 40);
  for (const [, v] of CPI_YOY_BY_YEAR) assert.ok(v > -5 && v < 50);
  assert.match(BENCHMARKS_AS_OF, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(policyRateOn('2014-01-01'), null);
  assert.equal(policyRateOn('2024-07-01'), 20.5);
  assert.equal(savingsRateOn('2024-07-01'), 17.5);
  assert.equal(inflationOn('2023-06-01'), 29.2);
  assert.equal(inflationOn('2031-01-01'), 4.0);
  assert.equal(inflationOn('2010-01-01'), null);
});

test('monthly expenses are stored on every portfolio, shown in the All view and validated', async () => {
  const { accountMonthlyExpenses, setAccountMonthlyExpenses, dashboardPortfolio, ALL_PORTFOLIOS } = await import('../lib/portfolio-account.ts');
  const { validate: validatePortfolio } = await import('../lib/portfolio.ts');
  const account = buildTestAccount(TODAY);
  const set = setAccountMonthlyExpenses(account, 60_000);
  assert.ok(set.portfolios.every((p) => p.portfolio.monthlyExpenses === 60_000));
  assert.equal(accountMonthlyExpenses(set), 60_000);
  assert.equal(dashboardPortfolio(set, ALL_PORTFOLIOS).monthlyExpenses, 60_000);
  const cleared = setAccountMonthlyExpenses(set, null);
  assert.equal(accountMonthlyExpenses(cleared), null);
  assert.ok(cleared.portfolios.every((p) => !('monthlyExpenses' in p.portfolio)));
  const base = account.portfolios[0].portfolio;
  for (const bad of [-1, Number.NaN, Infinity, 2e9, '5'])
    assert.throws(() => validatePortfolio({ ...base, monthlyExpenses: bad }), /monthly expenses/i);
  assert.doesNotThrow(() => validatePortfolio({ ...base, monthlyExpenses: 0 }));
});

test('month strip marks months with money in and the open month', async () => {
  const { monthStrip, nextMoneyStep } = await import('../lib/insights-guided.ts');
  const dots = monthStrip([flow('2026-08-03'), flow('2026-10-02')], TODAY, 4);
  assert.deepEqual(dots.map((d) => d.month), ['2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(dots.map((d) => d.done), [false, true, false, true]);
  assert.equal(dots[3].current, true);
  assert.equal(dots[0].label, 'J');
  assert.deepEqual(nextMoneyStep(0), { reached: null, next: 10_000, progress: 0 });
  const s = nextMoneyStep(1_492_902);
  assert.equal(s.reached, 1_000_000);
  assert.equal(s.next, 2_500_000);
  assert.ok(s.progress > 0.32 && s.progress < 0.33);
  assert.equal(nextMoneyStep(99_000_000).next, null);
});
