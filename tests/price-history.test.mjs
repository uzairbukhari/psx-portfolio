import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEod, parseIntraday, sliceRange, rangeChange, portfolioValueSeries, sliceValueRange } from '../lib/price-history.ts';

const DAY = 86_400;
test('parseEod sorts chronologically and drops bad rows', () => {
  const out = parseEod([[300, 3, 1, 3], [100, 1, 1, 1], [200, 0, 1, 1], [NaN, 5, 1, 1]]);
  assert.deepEqual(out, [[100, 1], [300, 3]]);
});
test('parseIntraday downsamples keeping first and last', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [1000 - i, 10 + i]);
  const out = parseIntraday(rows, 50);
  assert.equal(out.length, 50);
  assert.equal(out[0][0], 1);
  assert.equal(out.at(-1)[0], 1000);
});
test('sliceRange windows eod from the last point', () => {
  const eod = Array.from({ length: 400 }, (_, i) => [i * DAY, 100 + i]);
  assert.equal(sliceRange(eod, [], '7d').length, 8);
  assert.equal(sliceRange(eod, [[1, 2]], 'today').length, 1);
  assert.ok(sliceRange(eod, [], '1y').length <= 367);
  assert.deepEqual(sliceRange([], [], '1m'), []);
});
test('rangeChange', () => {
  assert.equal(rangeChange([[1, 100]]), null);
  assert.equal(rangeChange([[1, 100], [2, 110]]).percent, 10);
});

const sec = (date) => Date.parse(`${date}T12:00:00+05:00`) / 1000;
const trade = (id, ticker, kind, date, shares) => ({ id, ticker, kind, date, shares, price: 1, fees: 0, month: date.slice(0, 7), note: '' });
const pf = (trades, stockSplits = []) => ({ companies: [], trades, stockSplits, quotes: {}, budgets: {} });
test('portfolioValueSeries steps with buys, sells and carries closes forward', () => {
  const p = pf([trade('1', 'AAA', 'buy', '2026-01-02', 10), trade('2', 'AAA', 'sell', '2026-01-06', 4)]);
  const eod = { AAA: [[sec('2026-01-02'), 10], [sec('2026-01-05'), 12], [sec('2026-01-06'), 11]] };
  const { points, unpriced } = portfolioValueSeries(p, eod);
  assert.deepEqual(points, [
    { date: '2026-01-02', value: 100 },
    { date: '2026-01-05', value: 120 },
    { date: '2026-01-06', value: 66 },
  ]);
  assert.deepEqual(unpriced, []);
  const other = portfolioValueSeries(pf([trade('1', 'AAA', 'buy', '2026-01-02', 10), trade('2', 'BBB', 'buy', '2026-01-02', 1)]), {
    AAA: [[sec('2026-01-02'), 10], [sec('2026-01-05'), 12]],
    BBB: [[sec('2026-01-05'), 100]],
  });
  assert.deepEqual(other.points, [{ date: '2026-01-05', value: 220 }]);
});
test('portfolioValueSeries handles splits, unpriced tickers and the live point', () => {
  const p = pf([trade('1', 'AAA', 'buy', '2026-01-02', 10), trade('2', 'ZZZ', 'buy', '2026-01-02', 5)], [
    { id: 's', ticker: 'AAA', date: '2026-01-05', oldShares: 1, newShares: 2, note: '' },
  ]);
  const eod = { AAA: [[sec('2026-01-02'), 10], [sec('2026-01-05'), 6]] };
  const { points, unpriced } = portfolioValueSeries(p, eod, { date: '2026-01-05', value: 999 });
  assert.deepEqual(points, [{ date: '2026-01-02', value: 100 }, { date: '2026-01-05', value: 999 }]);
  assert.deepEqual(unpriced, ['ZZZ']);
  assert.equal(portfolioValueSeries(p, eod).points[1].value, 120);
});
test('sliceValueRange', () => {
  const pts = [{ date: '2025-01-01', value: 1 }, { date: '2026-05-01', value: 2 }, { date: '2026-05-20', value: 3 }];
  assert.equal(sliceValueRange(pts, 'all').length, 3);
  assert.equal(sliceValueRange(pts, '1m').length, 2);
  assert.equal(sliceValueRange(pts, '1y').length, 2);
});
