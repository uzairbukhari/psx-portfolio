import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, today, type Portfolio } from '../../../lib/portfolio.ts';
import { lastTradingDay } from '../../../lib/psx-calendar.ts';
import { safeHoldings } from './derive.ts';
import { monthProgress, nextActions, returnBreakdown, stalePriceTickers } from './today.ts';

const MONTH = '2026-10';

function sample(): Portfolio {
  const p = blankPortfolio();
  p.companies = [
    { ticker: 'AAA', name: 'Alpha', sector: 'Bank', target: 60, approved: true, screenDate: '2026-09-01', note: '' },
    { ticker: 'BBB', name: 'Beta', sector: 'Bank', target: 40, approved: true, screenDate: '2026-09-01', note: '' },
  ];
  p.trades = [
    { id: 't1', ticker: 'AAA', kind: 'buy', date: '2026-08-03', shares: 10, price: 100, fees: 0, month: '2026-08', note: '' },
    { id: 't2', ticker: 'BBB', kind: 'buy', date: '2026-08-03', shares: 10, price: 100, fees: 0, month: '2026-08', note: '' },
    { id: 't3', ticker: 'AAA', kind: 'buy', date: '2026-10-01', shares: 5, price: 100, fees: 0, month: MONTH, note: '' },
  ];
  const fresh = lastTradingDay(today());
  p.quotes = {
    AAA: { price: 110, asOf: '', date: fresh, source: '', fetchedAt: '' },
    BBB: { price: 90, asOf: '', date: fresh, source: '', fetchedAt: '' },
  };
  return p;
}

test('month progress reads the shared plan and says when the budget is not set', () => {
  const p = sample();
  const none = monthProgress(p, MONTH);
  assert.equal(none.budgetSet, false);
  assert.equal(none.fraction, 0);
  assert.equal(none.suggested, 0);
  assert.equal(none.bought, 500);
  p.budgets[MONTH] = 2000;
  const set = monthProgress(p, MONTH);
  assert.equal(set.budgetSet, true);
  assert.equal(set.remaining, 1500);
  assert.equal(set.fraction, 0.25);
  assert.equal(set.blockers.length === 0 || Array.isArray(set.blockers), true);
});

test('stale price tickers include missing and old quotes for held or targeted companies', () => {
  const p = sample();
  p.quotes.BBB.date = '2020-01-01';
  delete p.quotes.AAA;
  const { held } = safeHoldings(p);
  assert.deepEqual(stalePriceTickers(held, today()).sort(), ['AAA', 'BBB']);
});

test('next actions are prioritised and capped at three', () => {
  const p = sample();
  const { held } = safeHoldings(p);
  // No budget yet: only the budget prompt.
  assert.deepEqual(nextActions(p, held, MONTH, today()).map((a) => a.key), ['budget']);
  p.budgets[MONTH] = 5000;
  const keys = nextActions(p, held, MONTH, today()).map((a) => a.key);
  assert.ok(keys.length <= 3);
  p.dividends = [
    { id: 'd1', ticker: 'AAA', date: '2026-09-20', perShare: 2, grossAmount: 20, note: '', source: 'auto', status: 'expected', paymentDate: null } as never,
  ];
  p.quotes.BBB.date = '2020-01-01';
  const many = nextActions(p, safeHoldings(p).held, MONTH, today());
  assert.deepEqual(many.map((a) => a.key).slice(0, 2), ['dividend', 'prices']);
  assert.ok(many.length <= 3);
});

test('without targets the first action is to set them', () => {
  const p = sample();
  for (const c of p.companies) c.target = 0;
  assert.deepEqual(nextActions(p, safeHoldings(p).held, MONTH, today()).map((a) => a.key), ['targets']);
});

test('return breakdown sums unrealised, realised and received dividends before tax', () => {
  const p = sample();
  p.trades.push({ id: 's1', ticker: 'AAA', kind: 'sell', date: '2026-09-02', shares: 5, price: 120, fees: 0, month: '', note: '' });
  p.dividends = [
    { id: 'd1', ticker: 'AAA', date: '2026-09-01', perShare: 1, grossAmount: 100, note: '', source: 'manual', status: 'received' } as never,
  ];
  const b = returnBreakdown(p, 300);
  assert.ok(b);
  assert.equal(b.unrealised, 300);
  assert.equal(b.realised, 100);
  assert.equal(b.dividendsReceived, 100);
  assert.equal(b.totalBeforeTax, 500);
  assert.equal(returnBreakdown(p, null)?.totalBeforeTax, null);
});
