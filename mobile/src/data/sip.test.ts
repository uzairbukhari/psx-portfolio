import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, validate } from '../../../lib/portfolio.ts';
import { buildPlan, monthBuys, setBudget, shiftMonth, unifiedPlanSource } from './sip.ts';

test('shiftMonth crosses year boundaries both ways', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-06', 0), '2026-06');
});

test('setBudget stores the amount for that month and rejects bad input', () => {
  const p = blankPortfolio();
  const next = setBudget(p, '2026-10', 50000);
  validate(next);
  assert.equal(next.budgets['2026-10'], 50000);
  assert.equal(p.budgets['2026-10'], undefined);
  assert.throws(() => setBudget(p, '2026-13', 1), /Invalid month/);
  assert.throws(() => setBudget(p, '2026-10', -5), /zero or more/);
});

test('buildPlan reports errors instead of throwing when targets are missing', () => {
  const p = blankPortfolio();
  p.companies = [{ ticker: 'AAA', name: 'A', sector: 'Bank', target: 0, approved: true, screenDate: '', note: '' }];
  const r = buildPlan(p, '2026-10', 0, false);
  assert.equal(r.error, null);
  assert.ok(r.plan?.errors.some((e) => /total 100/.test(e)));
});

test('buildPlan spends within the budget for an eligible company with a price', () => {
  const p = blankPortfolio();
  const day = new Date().toISOString().slice(0, 10);
  p.companies = [{ ticker: 'AAA', name: 'A', sector: 'Bank', target: 100, approved: true, screenDate: day, note: '' }];
  p.quotes = { AAA: { price: 100, asOf: '', date: day, source: 'https://dps.psx.com.pk/company/AAA', fetchedAt: '' } };
  const month = day.slice(0, 7);
  p.budgets[month] = 1000;
  const r = buildPlan(p, month, 0, true);
  assert.ok(r.plan);
  assert.equal(r.plan.errors.length, 0);
  assert.ok(r.plan.invested <= 1000);
  assert.ok(r.plan.rows[0].shares > 0);
});

test('unifiedPlanSource plans once across portfolios with the home budget and targets', () => {
  const co = (ticker: string, target: number) => ({ ticker, name: ticker, sector: 'Bank', target, approved: true, screenDate: '2026-01-01', note: '' });
  const home = blankPortfolio();
  home.companies = [co('AAA', 100)];
  home.budgets['2026-10'] = 50000;
  const other = blankPortfolio();
  other.companies = [co('BBB', 50)];
  other.budgets['2026-10'] = 99999;
  const account = { version: 1, portfolios: [{ id: 'a', name: 'Home', portfolio: home }, { id: 'b', name: 'Other', portfolio: other }] } as never;
  const { home: h, portfolio } = unifiedPlanSource(account);
  assert.equal(h.id, 'a');
  assert.equal(portfolio.budgets['2026-10'], 50000);
  assert.deepEqual(portfolio.companies.map((c) => [c.ticker, c.target]), [['AAA', 100], ['BBB', 0]]);
  const r = buildPlan(portfolio, '2026-10', 0, true);
  assert.equal(r.error, null);
});

test('monthBuys lists what counts toward the month, newest first, and adds up to the plan figure', () => {
  const p = blankPortfolio();
  p.companies = [{ ticker: 'AAA', name: 'A', sector: 'Bank', target: 100, approved: true, screenDate: '', note: '' }];
  const trade = (id: string, date: string, month: string, kind: 'buy' | 'sell' = 'buy', voided = false) => ({ id, ticker: 'AAA', kind, shares: 10, price: 100, date, fees: 5, month, note: '', ...(voided ? { voided: true } : {}) });
  p.trades = [trade('a', '2026-10-02', ''), trade('b', '2026-09-30', '2026-10'), trade('c', '2026-10-05', '', 'sell'), trade('d', '2026-10-06', '', 'buy', true), trade('e', '2026-10-09', '2026-11')];
  const buys = monthBuys(p, '2026-10');
  assert.deepEqual(buys.map((b) => b.id), ['a', 'b']);
  assert.equal(buys.reduce((n, b) => n + b.amount, 0), 2010);
  p.quotes = { AAA: { price: 100, date: '2026-10-05', asOf: 't', source: 's', fetchedAt: '2026-10-05T06:00:00Z' } };
  assert.equal(buildPlan(p, '2026-10', 0, true).plan?.already, 2010);
});
