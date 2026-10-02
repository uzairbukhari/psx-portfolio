import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio } from '../../../lib/portfolio.ts';
import { filterCompanies, splitPreview, tradeTotals } from './entry-form.ts';

test('a buy total includes fees and a sale total deducts them', () => {
  assert.deepEqual(tradeTotals('buy', 100, 50.5, 25), { gross: 5050, fees: 25, total: 5075, label: 'Total cost including fees' });
  assert.equal(tradeTotals('sell', 100, 50.5, 25)?.total, 5025);
  assert.equal(tradeTotals('buy', 3, 0.1, null)?.total, 0.3, 'rounded to paisa');
});

test('totals wait for usable shares and price', () => {
  assert.equal(tradeTotals('buy', null, 10, 0), null);
  assert.equal(tradeTotals('buy', 10, null, 0), null);
  assert.equal(tradeTotals('opening', 10, 0, 0), null);
  assert.equal(tradeTotals('buy', 0, 10, 0), null);
  assert.equal(tradeTotals('buy', 10, 10, -5)?.total, 100, 'negative fees are ignored');
});

function held() {
  const p = blankPortfolio();
  p.companies = [{ ticker: 'AAA', name: 'Alpha Bank', sector: 'Bank', target: 0, approved: true, screenDate: '', note: '' }];
  p.trades = [{ id: 't1', ticker: 'AAA', kind: 'buy', date: '2026-01-05', shares: 40, price: 10, fees: 0, month: '', note: '' }];
  return p;
}

test('split preview shows holdings before and after', () => {
  assert.deepEqual(splitPreview(held(), 'AAA', '2026-06-01', 4, 5), { before: 40, after: 50 });
  assert.deepEqual(splitPreview(held(), 'AAA', '2026-01-01', 4, 5), { before: 0, after: 0 }, 'nothing held before the buy');
});

test('split preview rejects bad ratios and fractional results', () => {
  assert.equal(splitPreview(held(), 'AAA', '2026-06-01', 5, 4), null);
  assert.equal(splitPreview(held(), '', '2026-06-01', 4, 5), null);
  const odd = splitPreview(held(), 'AAA', '2026-06-01', 3, 4);
  assert.ok(odd && 'error' in odd, '40 x 4/3 is fractional');
});

test('filterCompanies matches ticker or name, tickers first, case-insensitively', () => {
  const list = [
    { ticker: 'MEBL', name: 'Meezan Bank' },
    { ticker: 'LUCK', name: 'Lucky Cement' },
    { ticker: 'BAFL', name: 'Bank Alfalah' },
  ];
  assert.deepEqual(filterCompanies(list, '').map((c) => c.ticker), ['BAFL', 'LUCK', 'MEBL']);
  assert.deepEqual(filterCompanies(list, 'bank').map((c) => c.ticker), ['BAFL', 'MEBL']);
  assert.deepEqual(filterCompanies(list, ' lu ').map((c) => c.ticker), ['LUCK']);
  assert.deepEqual(filterCompanies(list, 'zzz'), []);
});
