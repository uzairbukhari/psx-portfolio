import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioCounts } from '../lib/portfolio-counts.ts';

const company = (ticker) => ({ ticker, name: ticker, sector: 'X', target: 0, approved: true, screenDate: '2026-01-01', note: '' });
const trade = (id, ticker, kind, shares) => ({ id, ticker, kind, date: '2026-01-05', shares, price: 10, fees: 0, note: '' });

test('counts are unique and tied to their definitions', () => {
  const p = { companies: [company('A'), company('B'), company('C')], trades: [trade('1', 'A', 'buy', 10), trade('2', 'B', 'buy', 5), trade('3', 'B', 'sell', 5)], quotes: {}, budgets: {} };
  const c = portfolioCounts(p, ['A', 'A', 'C', 'ZZZ'], ['A', 'B']);
  assert.deepEqual(c, { savedCompanies: 3, holdings: 1, shortlisted: 2, assessed: 1 });
});
test('an empty portfolio yields zeros and assessed stays null before a run', () => {
  assert.deepEqual(portfolioCounts({ companies: [], trades: [], quotes: {}, budgets: {} }, []), { savedCompanies: 0, holdings: 0, shortlisted: 0, assessed: null });
});
