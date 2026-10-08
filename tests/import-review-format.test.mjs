import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodos, brokerHoldingChanges, dayMonth, fmtPrice, fmtQty, fmtRs, groupByMonth, monthLabel, openTodos } from '../lib/import-review-format.ts';
import { blankPortfolio } from '../lib/portfolio.ts';

test('formats numbers and dates for the review', () => {
  assert.equal(fmtQty(1250), '1,250');
  assert.equal(fmtPrice(1102.1), '1,102.10');
  assert.equal(fmtPrice(312.4567), '312.4567');
  assert.equal(fmtRs(115125.6), 'Rs 115,126');
  assert.equal(dayMonth('2026-07-03'), '3 Jul');
  assert.equal(monthLabel('2026-09-12'), 'September 2026');
});

test('groups consecutive rows by month and keeps order', () => {
  const groups = groupByMonth([{ date: '2026-07-03' }, { date: '2026-07-10' }, { date: '2026-08-02' }, { date: '2026-07-20' }]);
  assert.deepEqual(groups.map((g) => [g.label, g.rows.length]), [['July 2026', 2], ['August 2026', 1], ['July 2026', 1]]);
});

test('checklist drops blockers a decision already explains', () => {
  const todos = buildTodos({
    decisions: [{ key: 'decide', text: 'Decide 2 trades', done: false, anchor: 'row-1' }],
    blockers: ['2 rows need your decision before importing.', 'Cannot sell more than held.'],
    covered: /need your decision/,
  });
  assert.deepEqual(todos.map((t) => t.text), ['Decide 2 trades', 'Cannot sell more than held.']);
  assert.equal(openTodos(todos), 2);
  assert.equal(openTodos([{ key: 'a', text: 'x', done: true }]), 0);
});

test('broker holdings preview applies chosen trades and adjustments', () => {
  const p = blankPortfolio();
  p.companies.push({ ticker: 'MEBL', name: 'Meezan Bank', sector: '', target: 0, approved: true, screenDate: '', note: '' });
  p.trades.push({ id: 't1', ticker: 'MEBL', kind: 'opening', date: '2026-01-01', shares: 100, price: 100, fees: 0, month: '', note: '' });
  const trade = (side, shares) => ({ ticker: 'MEBL', date: '2026-07-01', side, shares, price: 300, fees: 0, reference: null, line: 1 });
  const plan = {
    rows: [
      { key: 'a', trade: trade('buy', 50), status: 'new', action: 'import' },
      { key: 'b', trade: trade('sell', 20), status: 'new', action: 'import' },
      { key: 'c', trade: trade('buy', 999), status: 'new', action: 'skip' },
    ],
    adjustments: [{ key: 'adj', ticker: 'LUCK', asOf: '2026-09-30', before: 0, reported: 10, difference: 10, action: 'import' }],
    blockers: [], newCompanies: [], accountId: 'X:Y', assignIds: [],
  };
  const changes = brokerHoldingChanges(p, plan);
  assert.deepEqual(changes.map((c) => [c.ticker, c.beforeShares, c.afterShares, c.afterCostKnown]), [['LUCK', 0, 10, false], ['MEBL', 100, 130, true]]);
});

test('footer explains why the button is disabled', async () => {
  const { footerStatus } = await import('../lib/import-review-format.ts');
  assert.deepEqual(footerStatus({ open: 2, noop: false, stale: false }), { text: '2 things to decide before importing', ok: false });
  assert.deepEqual(footerStatus({ open: 1, noop: false, stale: false }), { text: '1 thing to decide before importing', ok: false });
  assert.equal(footerStatus({ open: 0, noop: true, stale: false }).text, 'Nothing new to import');
  assert.equal(footerStatus({ open: 0, noop: false, stale: true }).ok, false);
  assert.deepEqual(footerStatus({ open: 0, noop: false, stale: false }), { text: 'Ready to import', ok: true });
});

test('date range label', async () => {
  const { dateRangeLabel } = await import('../lib/import-review-format.ts');
  assert.equal(dateRangeLabel(['2026-09-12', '2026-07-03', '2026-08-01']), '3 Jul 2026 to 12 Sep 2026');
  assert.equal(dateRangeLabel(['2026-07-03']), '3 Jul 2026');
  assert.equal(dateRangeLabel([]), '');
});
