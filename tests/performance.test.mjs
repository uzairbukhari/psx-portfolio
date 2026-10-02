import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio } from '../lib/portfolio.ts';
import { benchmarkComparison, moneyInFlows, moneyInSeries, moneyWeightedReturn, tradedTickers, valueVsMoneyIn, xirr } from '../lib/performance.ts';

const sec = (date) => Date.parse(`${date}T12:00:00+05:00`) / 1000;
const trade = (id, ticker, kind, date, shares, price, fees = 0, extra = {}) => ({ id, ticker, kind, date, shares, price, fees, month: date.slice(0, 7), note: '', ...extra });
const company = (ticker) => ({ ticker, name: ticker, sector: 'Bank', target: 0, approved: true, screenDate: '2026-01-01', note: '' });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

function ledger() {
  const p = blankPortfolio();
  p.companies = [company('AAA')];
  p.trades = [
    trade('1', 'AAA', 'buy', '2026-01-05', 10, 100, 5),
    trade('2', 'AAA', 'buy', '2026-01-05', 5, 100, 2),
    trade('3', 'AAA', 'sell', '2026-02-02', 4, 120, 3),
    trade('4', 'AAA', 'buy', '2026-02-03', 1, 90, 0, { voided: true }),
  ];
  return p;
}

test('money in adds buys with fees, subtracts net sale proceeds, skips voided and sums per date', () => {
  const { flows, unknownCost } = moneyInFlows(ledger());
  assert.deepEqual(flows, [
    { date: '2026-01-05', amount: 1507 },
    { date: '2026-02-02', amount: -477 },
  ]);
  assert.deepEqual(unknownCost, []);
  assert.deepEqual(moneyInSeries(flows, ['2026-01-04', '2026-01-05', '2026-02-01', '2026-02-02', '2026-03-01']), [0, 1507, 1507, 1030, 1030]);
});

test('an opening balance without a cost is listed, not guessed; dividends never count', () => {
  const p = ledger();
  p.trades.push(trade('o', 'BBB', 'opening', '2026-01-01', 50, null));
  p.dividends = [{ id: 'd', ticker: 'AAA', date: '2026-03-01', source: 'manual', status: 'received', shares: 10, grossAmount: 500, taxWithheld: 75, note: '' }];
  const { flows, unknownCost } = moneyInFlows(p);
  assert.deepEqual(unknownCost, ['BBB']);
  assert.equal(flows.length, 2);
});

test('xirr: single deposit grows to a year-end value', () => {
  near(xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }]), 0.1, 1e-9);
  // 2024 is a leap year: 366 days / 365
  near(xirr([{ date: '2024-01-01', amount: -1000 }, { date: '2025-01-01', amount: 1100 }]), Math.pow(1.1, 365 / 366) - 1, 1e-9);
});

test('xirr: matches the Excel documentation example', () => {
  // Excel XIRR help: -10000 2008-01-01, 2750 2008-03-01, 4250 2008-10-30, 3250 2009-02-15, 2750 2009-04-01 -> 0.373362535
  const r = xirr([
    { date: '2008-01-01', amount: -10000 },
    { date: '2008-03-01', amount: 2750 },
    { date: '2008-10-30', amount: 4250 },
    { date: '2009-02-15', amount: 3250 },
    { date: '2009-04-01', amount: 2750 },
  ]);
  near(r, 0.373362535, 1e-6);
});

test('xirr: losses give a negative rate and the result zeroes the NPV', () => {
  const flows = [{ date: '2025-01-01', amount: -1000 }, { date: '2025-07-01', amount: -500 }, { date: '2026-01-01', amount: 1200 }];
  const r = xirr(flows);
  assert.ok(r < 0 && r > -1);
  const t0 = Date.parse('2025-01-01T00:00:00Z');
  const npv = flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (Date.parse(`${f.date}T00:00:00Z`) - t0) / 86_400_000 / 365), 0);
  near(npv, 0, 1e-4);
});

test('xirr: extreme rates fall back to bisection', () => {
  const r = xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-04-01', amount: 1000 }]);
  assert.ok(r > 100 && Number.isFinite(r));
  const loss = xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1 }]);
  near(loss, -0.999, 1e-6);
});

test('xirr returns null with no solution or insufficient data', () => {
  assert.equal(xirr([]), null);
  assert.equal(xirr([{ date: '2026-01-01', amount: -100 }]), null);
  assert.equal(xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-06-01', amount: -50 }]), null);
  assert.equal(xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-01-01', amount: 120 }]), null);
  assert.equal(xirr([{ date: '2026-01-01', amount: -100 }, { date: '2026-06-01', amount: 0 }]), null);
  assert.equal(xirr([{ date: 'bad', amount: -100 }, { date: '2026-06-01', amount: 150 }]), null);
});

test('money-weighted return uses the value as the terminal flow and needs a real span', () => {
  const flows = [{ date: '2025-01-01', amount: 1000 }];
  const ok = moneyWeightedReturn(flows, 1100, '2026-01-01');
  assert.equal(ok.reason, 'ok');
  near(ok.rate, 0.1, 1e-9);
  assert.equal(moneyWeightedReturn(flows, 1100, '2025-02-01').reason, 'too-short');
  assert.equal(moneyWeightedReturn([], 1100, '2026-01-01').reason, 'no-flows');
  assert.equal(moneyWeightedReturn(flows, 0, '2026-01-01').reason, 'no-solution');
  // sold out: proceeds are the positive flows, terminal value 0
  const out = moneyWeightedReturn([{ date: '2025-01-01', amount: 1000 }, { date: '2025-12-01', amount: -1200 }], 0, '2026-01-01');
  assert.equal(out.reason, 'ok');
  assert.ok(out.rate > 0.19 && out.rate < 0.3);
});

test('value vs money in lines up value with cumulative money in and flags gaps', () => {
  const p = ledger();
  const eod = { AAA: [[sec('2026-01-05'), 100], [sec('2026-01-06'), 110], [sec('2026-02-02'), 120], [sec('2026-02-03'), 125]] };
  const out = valueVsMoneyIn(p, eod);
  assert.deepEqual(out.points.map((x) => [x.date, x.value, x.moneyIn]), [
    ['2026-01-05', 1500, 1507],
    ['2026-01-06', 1650, 1507],
    ['2026-02-02', 1320, 1030],
    ['2026-02-03', 1375, 1030],
  ]);
  assert.equal(out.incomplete, false);
  assert.equal(out.startsLater, false);
  // history that starts after the first trade starts the series later
  const late = valueVsMoneyIn(p, { AAA: [[sec('2026-01-20'), 100]] });
  assert.equal(late.startsLater, true);
  assert.equal(late.points[0].moneyIn, 1507);
  // no history at all: nothing to draw, held ticker listed
  const none = valueVsMoneyIn(p, {});
  assert.deepEqual(none.points, []);
  assert.deepEqual(none.unpriced, ['AAA']);
  assert.equal(none.incomplete, true);
});

const index = [
  [sec('2026-01-02'), 1000],
  [sec('2026-01-05'), 1000],
  [sec('2026-01-06'), 1100],
  [sec('2026-02-02'), 1200],
  [sec('2026-02-03'), 1250],
];

test('benchmark invests each flow at the nearest close on or before and values it daily', () => {
  const flows = [{ date: '2026-01-05', amount: 1000 }, { date: '2026-01-31', amount: 600 }];
  const valueSeries = [
    { date: '2026-01-05', value: 1000 },
    { date: '2026-01-06', value: 1050 },
    { date: '2026-02-02', value: 1700 },
    { date: '2026-02-03', value: 1720 },
  ];
  const b = benchmarkComparison({ flows, valueSeries, index, currentValue: 1720, asOf: '2026-02-03' });
  assert.equal(b.available, true);
  assert.equal(b.truncated, false);
  // 1 unit at 1000, then 600 on 31 Jan buys at the 6 Jan close (1100) = 0.545454 units
  const units = 1 + 600 / 1100;
  near(b.benchmarkEnd, Math.round(units * 1250 * 100) / 100, 0.006);
  assert.deepEqual(b.points.map((x) => x.date), ['2026-01-05', '2026-01-06', '2026-02-02', '2026-02-03']);
  near(b.points[0].benchmark, 1000);
  near(b.points[1].benchmark, 1100);
  near(b.points[2].benchmark, units * 1200, 0.01);
  assert.equal(b.indexAsOf, '2026-02-03');
  assert.equal(b.benchmarkReturn.reason, 'too-short');
});

test('benchmark XIRR matches a hand calculation over a long window', () => {
  const longIndex = [[sec('2025-01-01'), 1000], [sec('2026-01-01'), 1200]];
  const flows = [{ date: '2025-01-01', amount: 1000 }];
  const b = benchmarkComparison({ flows, valueSeries: [{ date: '2025-01-01', value: 1000 }, { date: '2026-01-01', value: 1300 }], index: longIndex, currentValue: 1300, asOf: '2026-01-01' });
  assert.equal(b.available, true);
  near(b.benchmarkReturn.rate, 0.2, 1e-9);
  near(b.portfolioReturn.rate, 0.3, 1e-9);
});

test('benchmark starts at the first index date when the first flow is older, using that day\'s value', () => {
  const flows = [{ date: '2025-06-01', amount: 800 }, { date: '2026-01-06', amount: 100 }];
  const valueSeries = [
    { date: '2025-12-01', value: 900 },
    { date: '2026-01-02', value: 950 },
    { date: '2026-01-05', value: 960 },
    { date: '2026-01-06', value: 1100 },
    { date: '2026-02-03', value: 1300 },
  ];
  const b = benchmarkComparison({ flows, valueSeries, index, currentValue: 1300, asOf: '2026-02-03' });
  assert.equal(b.available, true);
  assert.equal(b.truncated, true);
  assert.equal(b.startDate, '2026-01-02');
  assert.equal(b.firstFlowDate, '2025-06-01');
  assert.equal(b.points[0].date, '2026-01-02');
  near(b.points[0].benchmark, 950);
  near(b.points[0].portfolio, 950);
});

test('benchmark says why it cannot draw', () => {
  const flows = [{ date: '2026-01-05', amount: 1000 }];
  const vs = [{ date: '2026-01-05', value: 1000 }];
  assert.deepEqual(benchmarkComparison({ flows, valueSeries: vs, index: [], currentValue: 1, asOf: '2026-02-03' }), { available: false, reason: 'no-index' });
  assert.deepEqual(benchmarkComparison({ flows: [], valueSeries: vs, index, currentValue: 1, asOf: '2026-02-03' }), { available: false, reason: 'no-flows' });
  assert.deepEqual(benchmarkComparison({ flows, valueSeries: [], index, currentValue: 1, asOf: '2026-02-03' }), { available: false, reason: 'no-value-series' });
});

test('a sale larger than the benchmark position is capped, never short', () => {
  const flows = [{ date: '2026-01-05', amount: 100 }, { date: '2026-01-06', amount: -500 }];
  const vs = [{ date: '2026-01-05', value: 100 }, { date: '2026-01-06', value: 0 }, { date: '2026-02-03', value: 0 }];
  const b = benchmarkComparison({ flows, valueSeries: vs, index, currentValue: 0, asOf: '2026-02-03' });
  assert.equal(b.available, true);
  assert.equal(b.cappedSale, true);
  assert.ok(b.points.every((x) => x.benchmark >= 0));
  near(b.benchmarkEnd, 0, 0.01);
});

test('tradedTickers lists open and sold-out companies once', () => {
  const p = ledger();
  p.trades.push(trade('5', 'ZZZ', 'buy', '2026-01-05', 1, 1));
  assert.deepEqual(tradedTickers(p), ['AAA', 'ZZZ']);
});
