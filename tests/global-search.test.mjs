import test from 'node:test';
import assert from 'node:assert/strict';
import { searchItems } from '../lib/global-search.ts';
import {
  trailingDividendPerShare,
  compactNumber,
} from '../lib/company-stats.ts';

const items = [
  {
    kind: 'company',
    key: 'MEBL',
    label: 'Meezan Bank Limited',
    sub: 'MEBL · Banks',
    owned: true,
  },
  { kind: 'company', key: 'MEBLX', label: 'Other Co', sub: 'MEBLX' },
  { kind: 'company', key: 'LUCK', label: 'Lucky Cement', sub: 'LUCK · Cement' },
  { kind: 'fund', key: 'f1', label: 'Meezan Islamic Fund', sub: 'Al Meezan' },
  {
    kind: 'metal',
    key: 'm1',
    label: '24k coins',
    sub: 'Gold',
    haystack: 'gold',
  },
  {
    kind: 'currency',
    key: 'c1',
    label: 'USD cash',
    sub: 'USD',
    haystack: 'USD',
  },
];

test('exact symbol ranks first and groups follow a fixed order', () => {
  const r = searchItems(items, 'mebl');
  assert.deepEqual(
    r.map((i) => i.key),
    ['MEBL', 'MEBLX'],
  );
  const m = searchItems(items, 'meezan');
  assert.deepEqual(
    m.map((i) => i.kind),
    ['company', 'fund'],
  );
});
test('gold and currency match by class words', () => {
  assert.deepEqual(
    searchItems(items, 'gold').map((i) => i.key),
    ['m1'],
  );
  assert.deepEqual(
    searchItems(items, 'usd').map((i) => i.key),
    ['c1'],
  );
  assert.deepEqual(searchItems(items, '  '), []);
});
test('dedupes the same company from holdings and the directory', () => {
  const r = searchItems(
    [...items, { kind: 'company', key: 'MEBL', label: 'Meezan Bank', sub: '' }],
    'mebl',
  );
  assert.equal(r.filter((i) => i.key === 'MEBL').length, 1);
});
test('trailing dividend per share', () => {
  const rows = [
    {
      kind: 'cash',
      percent: 50,
      perShareRs: null,
      bookClosureStart: '2026-03-01',
    },
    {
      kind: 'cash',
      percent: null,
      perShareRs: 2.5,
      bookClosureStart: '2026-01-01',
    },
    {
      kind: 'cash',
      percent: 100,
      perShareRs: null,
      bookClosureStart: '2024-01-01',
    },
    {
      kind: 'bonus',
      percent: 10,
      perShareRs: null,
      bookClosureStart: '2026-02-01',
    },
  ];
  assert.equal(trailingDividendPerShare(rows, 10, '2026-10-20'), 7.5);
  assert.equal(trailingDividendPerShare(rows, null, '2026-10-20'), null);
  assert.equal(trailingDividendPerShare([], null, '2026-10-20'), 0);
});
test('compact numbers', () => {
  assert.equal(compactNumber(103_600_000), '103.6M');
  assert.equal(compactNumber(5.2e12), '5.2T');
  assert.equal(compactNumber(null), '—');
});
