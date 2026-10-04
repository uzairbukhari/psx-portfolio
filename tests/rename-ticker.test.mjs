import test from 'node:test';
import assert from 'node:assert/strict';
import { renameTicker, validate, today, holdings } from '../lib/portfolio.ts';

const date = today();
const base = () => ({
  companies: [
    { ticker: 'WPFL', name: 'Wahdat', sector: 'Poultry', target: 100, approved: true, screenDate: date, note: '' },
  ],
  trades: [{ id: 't1', ticker: 'WPFL', date, kind: 'buy', shares: 10, price: 20, fees: 0, month: date.slice(0, 7), note: '' }],
  stockSplits: [],
  dividends: [{ id: 'auto-psx:WPFL:2026-01-01:2025-12-01', externalId: 'psx:WPFL:2026-01-01:2025-12-01', ticker: 'WPFL', date, source: 'auto', perShare: 1, grossAmount: 10, status: 'expected', note: '' }],
  quotes: { WPFL: { price: 20, date, asOf: date, source: 'https://dps.psx.com.pk/company/WPFL', fetchedAt: new Date().toISOString() } },
  budgets: {},
  monthlyPicksShortlist: ['WPFL'],
});

test('renameTicker moves the ledger, dividends, shortlist and drops the old quote', () => {
  const next = renameTicker(base(), 'WPFL', 'WAHDAT');
  assert.equal(next.companies[0].ticker, 'WAHDAT');
  assert.equal(next.trades[0].ticker, 'WAHDAT');
  assert.equal(next.dividends[0].ticker, 'WAHDAT');
  assert.equal(next.dividends[0].id, 'auto-psx:WAHDAT:2026-01-01:2025-12-01');
  assert.deepEqual(next.monthlyPicksShortlist, ['WAHDAT']);
  assert.equal(next.quotes.WPFL, undefined);
  validate(next);
  assert.equal(holdings(next)[0].shares, 10);
});

test('renameTicker leaves the input untouched and rejects bad targets', () => {
  const p = base();
  renameTicker(p, 'WPFL', 'WAHDAT');
  assert.equal(p.trades[0].ticker, 'WPFL');
  assert.throws(() => renameTicker(p, 'WPFL', 'wahdat!'));
  assert.throws(() => renameTicker(p, 'WPFL', 'WPFL'));
  assert.throws(() => renameTicker(p, 'NOPE', 'WAHDAT'));
  p.companies.push({ ...p.companies[0], ticker: 'WAHDAT' });
  assert.throws(() => renameTicker(p, 'WPFL', 'WAHDAT'), /already in your portfolio/);
});
