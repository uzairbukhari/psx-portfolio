import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio } from '../../../lib/portfolio.ts';
import { activeNotifications, activityEntries, formatPercent, openPositions, safeHoldings, totals } from './derive.ts';

function sample() {
  const p = blankPortfolio();
  p.companies = [
    { ticker: 'AAA', name: 'Alpha', sector: 'Bank', target: 0, approved: true, screenDate: '2026-01-01', note: '' },
    { ticker: 'BBB', name: 'Beta', sector: 'Bank', target: 0, approved: true, screenDate: '2026-01-01', note: '' },
    { ticker: 'CCC', name: 'Gamma', sector: 'Bank', target: 0, approved: true, screenDate: '2026-01-01', note: '' },
  ];
  p.trades = [
    { id: 't1', ticker: 'AAA', kind: 'buy', date: '2026-02-01', shares: 10, price: 100, fees: 0, month: '2026-02', note: '' },
    { id: 't2', ticker: 'BBB', kind: 'buy', date: '2026-02-02', shares: 5, price: 200, fees: 0, month: '2026-02', note: '' },
    { id: 't3', ticker: 'CCC', kind: 'buy', date: '2026-02-03', shares: 1, price: 50, fees: 0, month: '2026-02', note: '' },
    { id: 't4', ticker: 'CCC', kind: 'sell', date: '2026-03-01', shares: 1, price: 60, fees: 0, month: '2026-03', note: '', voided: false },
  ];
  p.quotes = { AAA: { price: 120, asOf: '', date: '2026-03-05', source: '', fetchedAt: '' } };
  return p;
}

test('totals only count priced positions with known cost', () => {
  const { held } = safeHoldings(sample());
  const t = totals(held);
  assert.equal(t.value, 1200);
  assert.equal(t.cost, 1000);
  assert.equal(t.gain, 200);
  assert.equal(Math.round(t.gainPercent ?? 0), 20);
  assert.equal(t.unpriced, 1, 'BBB has shares but no price');
});

test('openPositions hides sold-out companies and puts priced ones first', () => {
  const { held } = safeHoldings(sample());
  assert.deepEqual(openPositions(held).map((h) => h.ticker), ['AAA', 'BBB']);
});

test('safeHoldings reports an oversold ledger instead of throwing', () => {
  const p = sample();
  p.trades.push({ id: 'x', ticker: 'AAA', kind: 'sell', date: '2026-04-01', shares: 999, price: 1, fees: 0, month: '2026-04', note: '' });
  const r = safeHoldings(p);
  assert.match(r.error ?? '', /exceeds shares held/);
  assert.deepEqual(r.held, []);
});

test('activity is newest first, can filter by ticker, and skips voided entries', () => {
  const p = sample();
  p.trades[0].voided = true;
  const all = activityEntries(p);
  assert.deepEqual(all.map((e) => e.id), ['t4', 't3', 't2']);
  assert.deepEqual(activityEntries(p, 'CCC').map((e) => e.id), ['t4', 't3']);
});

test('dividends and splits join the activity list', () => {
  const p = sample();
  p.dividends = [{ id: 'd1', ticker: 'AAA', date: '2026-03-10', source: 'manual', netAmount: 85, perShare: 10, note: '' }];
  p.stockSplits = [{ id: 's1', ticker: 'AAA', date: '2026-03-20', oldShares: 1, newShares: 2, note: '' }];
  const kinds = activityEntries(p, 'AAA').map((e) => e.kind);
  assert.deepEqual(kinds, ['split', 'dividend', 'buy']);
});

test('cleared notifications are hidden', () => {
  const p = sample();
  p.notifications = [
    { id: 'a', at: '2026-03-01T00:00:00Z', kind: 'info', title: 'a', body: '', read: false },
    { id: 'b', at: '2026-03-02T00:00:00Z', kind: 'info', title: 'b', body: '', read: false, clearedAt: '2026-03-03T00:00:00Z' },
  ];
  assert.deepEqual(activeNotifications(p).map((n) => n.id), ['a']);
});

test('formatPercent signs and handles null', () => {
  assert.equal(formatPercent(12.345), '+12.35%');
  assert.equal(formatPercent(-1), '-1.00%');
  assert.equal(formatPercent(null), '—');
});
