import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, today } from '../../../lib/portfolio.ts';
import { lastTradingDay } from '../../../lib/psx-calendar.ts';
import { safeHoldings, openPositions } from './derive.ts';
import { filterBySector, holdingFlags, pricedLine, sectorsOf, sortHoldings, weightOf } from './holdings-view.ts';

function sample() {
  const p = blankPortfolio();
  p.companies = [
    { ticker: 'AAA', name: 'Alpha', sector: 'Bank', target: 0, approved: true, screenDate: '', note: '' },
    { ticker: 'BBB', name: 'Beta', sector: 'Cement', target: 0, approved: true, screenDate: '', note: '' },
    { ticker: 'CCC', name: 'Gamma', sector: 'Bank', target: 0, approved: true, screenDate: '', note: '' },
  ];
  p.trades = ['AAA', 'BBB', 'CCC'].map((ticker, i) => ({ id: `t${i}`, ticker, kind: 'buy' as const, date: '2026-02-01', shares: 10, price: 100, fees: 0, month: '', note: '' }));
  const fresh = lastTradingDay(today());
  p.quotes = {
    AAA: { price: 110, asOf: '', date: fresh, source: '', fetchedAt: '' },
    BBB: { price: 150, asOf: '', date: '2020-01-01', source: '', fetchedAt: '' },
  };
  return p;
}

const open = () => openPositions(safeHoldings(sample()).held);

test('sorting by value, gain, weight and name keeps unpriced companies last', () => {
  assert.deepEqual(sortHoldings(open(), 'value').map((h) => h.ticker), ['BBB', 'AAA', 'CCC']);
  assert.deepEqual(sortHoldings(open(), 'gain').map((h) => h.ticker), ['BBB', 'AAA', 'CCC']);
  assert.deepEqual(sortHoldings(open(), 'weight').map((h) => h.ticker), ['BBB', 'AAA', 'CCC']);
  assert.deepEqual(sortHoldings(open(), 'name').map((h) => h.ticker), ['AAA', 'BBB', 'CCC']);
});

test('weights are shares of priced value', () => {
  const o = open();
  const total = o.reduce((a, h) => a + (h.value ?? 0), 0);
  assert.equal(Math.round(weightOf(o.find((h) => h.ticker === 'AAA')!, total)! * 10) / 10, 42.3);
  assert.equal(weightOf(o.find((h) => h.ticker === 'CCC')!, total), null);
});

test('sector list and filter', () => {
  const o = open();
  assert.deepEqual(sectorsOf(o), ['Bank', 'Cement']);
  assert.deepEqual(filterBySector(o, 'Bank').map((h) => h.ticker).sort(), ['AAA', 'CCC']);
  assert.equal(filterBySector(o, null).length, 3);
});

test('flags mark stale quotes and expected dividends', () => {
  const p = sample();
  p.dividends = [{ id: 'd', ticker: 'AAA', date: '2026-09-20', perShare: 1, grossAmount: 10, note: '', source: 'auto', status: 'expected' } as never];
  const flags = holdingFlags(p, openPositions(safeHoldings(p).held), today());
  assert.equal(flags.get('AAA')?.stale, false);
  assert.equal(flags.get('AAA')?.expectedDividend, true);
  assert.equal(flags.get('BBB')?.stale, true);
  assert.equal(flags.get('CCC')?.stale, false, 'no quote is "no price", not stale');
});

test('priced line', () => {
  assert.equal(pricedLine(open(), '2020-01-01', (d) => d), '2 of 3 priced · oldest price 2020-01-01');
  assert.equal(pricedLine([], null, (d) => d), null);
});
