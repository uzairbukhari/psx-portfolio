import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFinqalabPlan, finqalabPlanIsNoop, parseFinqalabReport, planFinqalabImport } from '../app/finqalab-import.ts';
import { splitFromProposal } from '../lib/import-splits.ts';
import { blankPortfolio, validate } from '../lib/portfolio.ts';

const report = `Periodic Trade Details Report By Finqalab
Total Records: 3
BIPL 9694933 2025-10-03 2025-10-07 BUY 42.1 6 252.6 0.10525 0.6315 0
BIPL 9729865 2025-10-08 2025-10-10 BUY 39.7 94 3731.8 0.09925 9.3295 0
WTL 10423676 2026-01-14 2026-01-16 SELL 1.77 68 120.36 0.029913 2.04 0`;
const rows = parseFinqalabReport(report);
const base = () => {
  const p = blankPortfolio();
  p.companies.push({ ticker: 'BIPL', name: 'BankIslami', sector: 'Bank', target: 0, approved: false, screenDate: '', note: '' });
  p.companies.push({ ticker: 'WTL', name: 'WTL', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({ id: 'open-wtl', ticker: 'WTL', kind: 'opening', date: '2025-01-01', shares: 68, price: null, fees: 0, month: '', note: '' });
  return p;
};

test('plan lists new rows and apply validates', () => {
  const plan = planFinqalabImport(base(), rows);
  assert.equal(plan.counts.imported, 3);
  assert.equal(plan.range.from, '2025-10-03');
  assert.equal(plan.blockers.length, 0);
  const next = applyFinqalabPlan(base(), plan);
  validate(next);
  assert.equal(next.trades.length, 4);
});

test('unknown symbols are added unapproved with no target', () => {
  const p = base();
  const plan = planFinqalabImport(p, parseFinqalabReport(report.replace(/BIPL 9694933/, 'QQQ 9694933')));
  assert.deepEqual(plan.newCompanies, ['QQQ']);
  const next = applyFinqalabPlan(p, plan);
  const c = next.companies.find((x) => x.ticker === 'QQQ');
  assert.equal(c.approved, false);
  assert.equal(c.target, 0);
});

test('a sale larger than the ledger holds blocks the import with the reason', () => {
  const p = base();
  p.trades = [];
  const plan = planFinqalabImport(p, rows);
  assert.ok(plan.blockers.some((b) => /sale exceeds shares held/.test(b)));
});

test('re-importing is a no-op', () => {
  const first = applyFinqalabPlan(base(), planFinqalabImport(base(), rows));
  const again = planFinqalabImport(first, rows);
  assert.equal(again.counts.duplicate, 3);
  assert.ok(finqalabPlanIsNoop(again));
});

test('an identical manual entry is skipped, a lookalike with other fees needs a decision', () => {
  const p = base();
  p.trades.push({ id: 'm1', ticker: 'BIPL', kind: 'buy', date: '2025-10-03', shares: 6, price: 42.1, fees: 0.6315, month: '2025-10', note: '' });
  p.trades.push({ id: 'm2', ticker: 'BIPL', kind: 'buy', date: '2025-10-08', shares: 94, price: 39.7, fees: 1, month: '2025-10', note: '' });
  const plan = planFinqalabImport(p, rows);
  assert.equal(plan.rows[0].status, 'duplicate');
  assert.equal(plan.rows[1].status, 'ambiguous');
  assert.ok(plan.blockers.some((b) => /need your decision/.test(b)));
  assert.throws(() => applyFinqalabPlan(p, plan));
  const decided = planFinqalabImport(p, rows, { resolutions: { 'finqalab:9729865': { action: 'import' } } });
  assert.equal(decided.blockers.length, 0);
  assert.equal(decided.counts.imported, 2);
});

test('a row imported before and then voided is not brought back unless chosen', () => {
  const first = applyFinqalabPlan(base(), planFinqalabImport(base(), rows));
  first.trades.find((t) => t.externalId === 'finqalab:9694933').voided = true;
  const plan = planFinqalabImport(first, rows);
  assert.equal(plan.rows[0].status, 'previously-removed');
  assert.equal(plan.rows[0].action, 'skip');
  const again = planFinqalabImport(first, rows, { resolutions: { 'finqalab:9694933': { action: 'import' } } });
  validate(applyFinqalabPlan(first, again));
});

test('an accepted split is added with the trades', () => {
  const p = base();
  const split = splitFromProposal({ key: 'split:BIPL:2026-01-01:1:2', ticker: 'BIPL', oldShares: 1, newShares: 2, date: '2026-01-01', sourceUrl: 'https://example.test', sourceLabel: 'x' }, 's1');
  const plan = planFinqalabImport(p, rows, { splits: [split] });
  const next = applyFinqalabPlan(p, plan);
  assert.equal(next.stockSplits.length, 1);
  assert.equal(plan.holdingChanges.find((c) => c.ticker === 'BIPL').afterShares, 200);
});
