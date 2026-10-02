import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, holdings, portfolioSummary } from '../lib/portfolio.ts';

const co = (ticker) => ({ ticker, name: ticker, sector: 'Others', target: 0, approved: true, screenDate: '2026-09-01', note: '' });
const q = (price, date = '2026-09-30') => ({ price, date, asOf: date, source: '', fetchedAt: '' });
const buy = (id, ticker, shares, price) => ({ id, ticker, kind: 'buy', date: '2026-01-10', shares, price, fees: 0, month: '2026-01', note: '' });
const summary = (p) => portfolioSummary(holdings(p));

function base() {
  const p = blankPortfolio();
  p.companies = [co('AAA')];
  p.trades = [buy('t1', 'AAA', 100, 50)];
  p.quotes = { AAA: q(55) };
  return p;
}

test('complete portfolio reports value, cost, gain and the oldest quote date', () => {
  const p = base();
  p.companies.push(co('BBB'));
  p.trades.push(buy('t2', 'BBB', 10, 100));
  p.quotes.BBB = q(90, '2026-09-28');
  const s = summary(p);
  assert.deepEqual([s.heldCount, s.value, s.cost, s.gain], [2, 6400, 6000, 400]);
  assert.equal(Math.round(s.gainPercent * 100) / 100, 6.67);
  assert.deepEqual(s.incomplete, []);
  assert.equal(s.oldestQuoteDate, '2026-09-28');
});

test('unknown cost keeps the priced value but reports neither cost nor gain', () => {
  const p = base();
  p.companies.push(co('BBB'));
  p.trades.push({ ...buy('t2', 'BBB', 10, null), kind: 'opening' });
  p.quotes.BBB = q(100);
  const s = summary(p);
  assert.deepEqual([s.value, s.cost, s.gain, s.gainPercent], [6500, null, null, null]);
  assert.deepEqual(s.unknownCost, ['BBB']);
  assert.deepEqual(s.incomplete, ['unknown-cost']);
});

test('a holding without a quote leaves gain null but still sums priced value', () => {
  const p = base();
  p.companies.push(co('CCC'));
  p.trades.push(buy('t2', 'CCC', 10, 10));
  const s = summary(p);
  assert.deepEqual([s.value, s.cost, s.gain], [5500, 5100, null]);
  assert.deepEqual(s.missingPrice, ['CCC']);
  assert.deepEqual(s.incomplete, ['missing-price']);
});

test('a quote dated before the latest split counts as missing', () => {
  const p = base();
  p.stockSplits = [{ id: 's1', ticker: 'AAA', date: '2026-10-01', oldShares: 1, newShares: 2, note: '' }];
  const s = summary(p);
  assert.deepEqual(s.missingPrice, ['AAA']);
  assert.equal(s.gain, null);
  assert.equal(s.oldestQuoteDate, null);
});

test('empty portfolio is complete and zero', () => {
  const s = portfolioSummary(holdings(blankPortfolio()));
  assert.deepEqual([s.heldCount, s.value, s.cost, s.gain, s.gainPercent, s.oldestQuoteDate], [0, 0, 0, 0, null, null]);
  assert.deepEqual(s.incomplete, []);
});

test('sold-out companies are ignored', () => {
  const p = base();
  p.trades.push({ ...buy('t2', 'AAA', 100, 60), kind: 'sell', month: '' });
  const s = summary(p);
  assert.equal(s.heldCount, 0);
  assert.equal(s.gain, 0);
});
