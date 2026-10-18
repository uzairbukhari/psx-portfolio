import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestAccount } from '../lib/test-seed/account.ts';
import { accountOverview } from '../lib/account-overview.ts';
import {
  allocationTree,
  concentration,
  cumulativeByClass,
  monthCalendar,
  reportClasses,
  returnBridge,
  treeLeaves,
  allocationTakeaway,
} from '../lib/insights.ts';

const TODAY = '2026-10-16';
const account = buildTestAccount(TODAY);
const parts = account.portfolios;

test('the allocation tree adds up and every stock leaf carries its ticker', () => {
  const { root, total } = allocationTree(parts, TODAY);
  assert.ok(root.length > 0);
  assert.equal(
    Math.round(root.reduce((n, r) => n + r.value, 0) * 100) / 100,
    total,
  );
  const stocks = root.find((r) => r.classKey === 'stocks');
  assert.ok(stocks);
  for (const leaf of treeLeaves(stocks.children)) assert.ok(leaf.ticker);
  for (const node of root)
    assert.equal(
      Math.round(treeLeaves([node]).reduce((n, l) => n + l.value, 0)),
      Math.round(node.value),
    );
});

test('the tree matches the dashboard total for stocks', () => {
  const o = accountOverview(parts, TODAY);
  const { root } = allocationTree(parts, TODAY);
  const stocks = root.find((r) => r.classKey === 'stocks');
  const cls = o.classes.find((c) => c.key === 'stocks');
  assert.ok(stocks && cls);
  assert.ok(Math.abs(stocks.value - cls.value) < 1);
});

test('concentration: shares and effective holdings', () => {
  const c = concentration([
    { name: 'A', value: 50, classKey: 'stocks' },
    { name: 'B', value: 50, classKey: 'stocks' },
  ]);
  assert.equal(c.effective, 2);
  assert.equal(c.largest.share, 50);
  assert.equal(concentration([]).effective, null);
});

test('money in by class is cumulative and never negative', () => {
  const r = cumulativeByClass(parts, TODAY);
  assert.ok(r.months.length > 1);
  assert.equal(r.months.length, r.dates.length);
  for (const s of r.series) {
    assert.equal(s.data.length, r.months.length);
    assert.ok(s.data.every((n) => n >= 0));
  }
});

test('the return bridge sums to its total and never counts an unknown gain as zero', () => {
  const o = accountOverview(parts, TODAY);
  const b = returnBridge(o, parts);
  const steps = b.steps.filter((s) => s.kind === 'step');
  assert.equal(
    Math.round(steps.reduce((n, s) => n + s.value, 0) * 100) / 100,
    b.total,
  );
  const known = new Set(steps.map((s) => s.label));
  for (const c of o.classes)
    assert.ok(c.gain === null ? b.omitted.includes(c.label) && !known.has(c.label) : known.has(c.label));
});

test('the calendar covers every year from the first entry to today with 12 months each', () => {
  const m = monthCalendar(parts, TODAY);
  assert.equal(m.years.at(-1), 2026);
  assert.equal(m.income.length, m.years.length);
  assert.ok(m.income.every((row) => row.length === 12));
  assert.ok(m.investedTotal > 0);
});

test('reportClasses lists every report set a portfolio has, stocks by default', () => {
  assert.deepEqual(reportClasses({ trades: [] }), ['stocks']);
  assert.deepEqual(
    reportClasses({
      trades: [{}],
      assets: [{ kind: 'metal' }, { kind: 'fund' }],
    }),
    ['stocks', 'savings', 'metal'],
  );
  assert.deepEqual(reportClasses({ trades: [{ voided: true }], assets: [{ kind: 'currency' }] }), ['currency']);
});

test('the allocation headline names the biggest class', () => {
  const { root, total } = allocationTree(parts, TODAY);
  assert.match(allocationTakeaway(root, total), new RegExp(root[0].name));
  assert.match(allocationTakeaway([], 0), /Add holdings/);
});
