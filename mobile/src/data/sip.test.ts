import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, validate } from '../../../lib/portfolio.ts';
import { buildPlan, setBudget, shiftMonth } from './sip.ts';

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
