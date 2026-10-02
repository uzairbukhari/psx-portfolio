import test from 'node:test';
import assert from 'node:assert/strict';
import { holdings, positionTimeline } from '../lib/portfolio.ts';
import { fillChangeFromHistory, parseEod, parseIntraday, sliceRange, rangeChange, portfolioValueSeries, sliceValueRange } from '../lib/price-history.ts';

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
    { date: '2026-01-02', value: 100, cost: 10, gain: 90 },
    { date: '2026-01-05', value: 120, cost: 10, gain: 110 },
    { date: '2026-01-06', value: 66, cost: 6, gain: 60 },
  ]);
  assert.deepEqual(unpriced, []);
  const other = portfolioValueSeries(pf([trade('1', 'AAA', 'buy', '2026-01-02', 10), trade('2', 'BBB', 'buy', '2026-01-02', 1)]), {
    AAA: [[sec('2026-01-02'), 10], [sec('2026-01-05'), 12]],
    BBB: [[sec('2026-01-05'), 100]],
  });
  assert.deepEqual(other.points, [{ date: '2026-01-05', value: 220, cost: 11, gain: 209 }]);
});
test('portfolioValueSeries handles splits, unpriced tickers and the live point', () => {
  const p = pf([trade('1', 'AAA', 'buy', '2026-01-02', 10), trade('2', 'ZZZ', 'buy', '2026-01-02', 5)], [
    { id: 's', ticker: 'AAA', date: '2026-01-05', oldShares: 1, newShares: 2, note: '' },
  ]);
  const eod = { AAA: [[sec('2026-01-02'), 10], [sec('2026-01-05'), 6]] };
  const { points, unpriced } = portfolioValueSeries(p, eod, { date: '2026-01-05', value: 999, cost: 10, gain: 989 });
  assert.deepEqual(points, [{ date: '2026-01-02', value: 100, cost: 10, gain: 90 }, { date: '2026-01-05', value: 999, cost: 10, gain: 989 }]);
  assert.deepEqual(unpriced, ['ZZZ']);
  assert.equal(portfolioValueSeries(p, eod).points[1].value, 120);
});
test('sliceValueRange', () => {
  const pts = [{ date: '2025-01-01', value: 1 }, { date: '2026-05-01', value: 2 }, { date: '2026-05-20', value: 3 }];
  assert.equal(sliceValueRange(pts, 'all').length, 3);
  assert.equal(sliceValueRange(pts, '1m').length, 2);
  assert.equal(sliceValueRange(pts, '1y').length, 2);
});

test('positionTimeline ends where holdings() does and yields null cost for unknown openings', () => {
  const p = pf([trade('1', 'AAA', 'buy', '2026-01-02', 10), { ...trade('2', 'AAA', 'buy', '2026-01-03', 10), price: 3, fees: 2 }, trade('3', 'AAA', 'sell', '2026-01-04', 5)]);
  p.companies = [{ ticker: 'AAA' }];
  const h = holdings(p)[0];
  const last = positionTimeline(p, 'AAA').at(-1);
  assert.equal(last.shares, h.shares);
  assert.equal(last.cost, h.cost);
  const unknown = pf([{ ...trade('1', 'BBB', 'opening', '2026-01-02', 10), price: null }]);
  assert.equal(positionTimeline(unknown, 'BBB')[0].cost, null);
});
test('portfolioValueSeries gives null gain while an opening cost is unknown', () => {
  const p = pf([{ ...trade('1', 'BBB', 'opening', '2026-01-02', 10), price: null }]);
  const { points } = portfolioValueSeries(p, { BBB: [[sec('2026-01-02'), 5]] });
  assert.deepEqual(points, [{ date: '2026-01-02', value: 50, cost: null, gain: null }]);
});
test('portfolioValueSeries reports tickers whose ledger sells more than was held', () => {
  const p = pf([trade('1', 'AAA', 'buy', '2026-01-02', 10), trade('2', 'AAA', 'sell', '2026-01-06', 14), trade('3', 'BBB', 'buy', '2026-01-02', 1)]);
  const eod = { AAA: [[sec('2026-01-02'), 10]], BBB: [[sec('2026-01-02'), 5]] };
  assert.deepEqual(portfolioValueSeries(p, eod).inconsistent, ['AAA']);
  const clean = pf([trade('1', 'AAA', 'buy', '2026-01-02', 10)]);
  assert.deepEqual(portfolioValueSeries(clean, eod).inconsistent, []);
});

// PKT midnight of a calendar day as unix seconds.
const pkt = (d) => Date.parse(`${d}T00:00:00+05:00`) / 1000;
const row = (o = {}) => ({ ticker: 'MEBL', price: 110, change: null, changePercent: null, previousClose: null, ...o });
const hist = { MEBL: [[pkt('2026-09-29'), 98], [pkt('2026-09-30'), 100], [pkt('2026-10-01'), 105]] };
test('fillChangeFromHistory uses the close before the quote day (same-day eod row ignored)', () => {
  const [r] = fillChangeFromHistory([row()], hist, { MEBL: '2026-10-01' }, '2026-10-01');
  assert.equal(r.previousClose, 100);
  assert.equal(r.change, 10);
  assert.equal(r.changePercent, 10);
});
test('fillChangeFromHistory uses the latest close when the quote is from a later day', () => {
  const [r] = fillChangeFromHistory([row()], hist, { MEBL: '2026-10-02' }, '2026-10-02');
  assert.equal(r.previousClose, 105);
  assert.equal(r.change, 5);
});
test('fillChangeFromHistory leaves rows without history, price or with a change alone', () => {
  const rows = [row({ ticker: 'LUCK' }), row({ price: null }), row({ change: 1, changePercent: 1 })];
  const out = fillChangeFromHistory(rows, hist, {}, '2026-10-01');
  assert.deepEqual(out, rows);
});
test('fillChangeFromHistory spans a weekend or holiday gap', () => {
  const gap = { MEBL: [[pkt('2026-09-25'), 90], [pkt('2026-09-24'), 80]] };
  const [r] = fillChangeFromHistory([row({ price: 99 })], gap, { MEBL: '2026-09-28' }, '2026-09-28');
  assert.equal(r.previousClose, 90);
  assert.equal(r.change, 9);
  assert.equal(r.changePercent, 10);
});

test('eodKeep keeps a longer history for the KSE-100 only', async () => {
  const { eodKeep } = await import('../lib/price-history.ts');
  assert.equal(eodKeep('KSE100'), 2500);
  assert.equal(eodKeep('MEBL'), 420);
});
