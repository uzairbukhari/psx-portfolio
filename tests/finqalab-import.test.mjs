import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFinqalabReport, importFinqalabTrades } from '../app/finqalab-import.ts';

const report = `Periodic Trade Details Report By Finqalab
Total Records: 3
BIPL 9694933 2025-10-03 2025-10-07 BUY 42.1 6 252.6 0.10525 0.6315 0
BIPL 9729865 2025-10-08 2025-10-10 BUY 39.7 94 3731.8 0.09925 9.3295 0
WTL 10423676 2026-01-14 2026-01-16 SELL 1.77 68 120.36 0.029913 2.04 0
BIPL BUY TOTAL: 100 3984.40`;
const portfolio = () => ({
  companies: [{ ticker: 'BIPL', name: 'BankIslami', sector: 'Bank', target: 0, approved: false, screenDate: '', note: '' }],
  trades: [], quotes: {}, budgets: {},
});

test('parses Finqalab line items and excludes subtotal rows', () => {
  const rows = parseFinqalabReport(report);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2], { ticker: 'WTL', tradeNo: '10423676', date: '2026-01-14', kind: 'sell', price: 1.77, shares: 68, fees: 2.04 });
});

test('Finqalab import is idempotent and adds unknown symbols conservatively', () => {
  const rows = parseFinqalabReport(report);
  const first = importFinqalabTrades(portfolio(), rows);
  assert.equal(first.imported, 3);
  assert.equal(first.addedCompanies, 1);
  assert.equal(first.companies.find((c) => c.ticker === 'WTL').approved, false);
  const second = importFinqalabTrades({ ...portfolio(), companies: first.companies, trades: first.trades }, rows);
  assert.equal(second.imported, 0);
  assert.equal(second.skippedDuplicate, 3);
});

test('exact manual entries are not duplicated and incomplete reports are rejected', () => {
  const rows = parseFinqalabReport(report);
  const p = portfolio();
  p.trades.push({ id: 'manual', ticker: 'BIPL', kind: 'buy', date: '2025-10-03', shares: 6, price: 42.1, fees: 0.6315, month: '2025-10', note: '' });
  const result = importFinqalabTrades(p, rows);
  assert.equal(result.imported, 2, 'fees must match exactly, including broker precision');
  assert.equal(result.skippedManualMatch, 1);
  assert.throws(() => parseFinqalabReport(report.replace('Total Records: 3', 'Total Records: 4')));
});
