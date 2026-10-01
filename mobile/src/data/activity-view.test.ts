import test from 'node:test';
import assert from 'node:assert/strict';
import type { ActivityEntry } from './derive.ts';
import { filterActivity, groupByMonth } from './activity-view.ts';

const e = (id: string, date: string, kind: ActivityEntry['kind'], ticker: string, detail = ''): ActivityEntry => ({
  id, date, kind, ticker, title: kind, detail, amount: 1, editable: true,
});
const entries = [
  e('1', '2026-10-02', 'buy', 'MEBL', '@ 300'),
  e('2', '2026-10-01', 'dividend', 'LUCK'),
  e('3', '2026-09-15', 'sell', 'MEBL'),
  e('4', '2026-09-01', 'opening', 'LUCK'),
  e('5', '2025-12-31', 'split', 'LUCK', '4 → 5 shares'),
];

test('type filter treats opening balances as buys', () => {
  assert.deepEqual(filterActivity(entries, 'buy', '').map((x) => x.id), ['1', '4']);
  assert.deepEqual(filterActivity(entries, 'sell', '').map((x) => x.id), ['3']);
  assert.equal(filterActivity(entries, 'all', '').length, 5);
});

test('search matches ticker, detail and date, combined with the filter', () => {
  assert.deepEqual(filterActivity(entries, 'all', 'mebl').map((x) => x.id), ['1', '3']);
  assert.deepEqual(filterActivity(entries, 'all', '2026-09').map((x) => x.id), ['3', '4']);
  assert.deepEqual(filterActivity(entries, 'sell', 'mebl').map((x) => x.id), ['3']);
  assert.deepEqual(filterActivity(entries, 'all', '→').map((x) => x.id), ['5']);
});

test('month sections keep order and name the month', () => {
  const sections = groupByMonth(entries);
  assert.deepEqual(sections.map((s) => [s.key, s.title, s.data.length]), [
    ['2026-10', 'October 2026', 2],
    ['2026-09', 'September 2026', 2],
    ['2025-12', 'December 2025', 1],
  ]);
  assert.deepEqual(groupByMonth([]), []);
});
