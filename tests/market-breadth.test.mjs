import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marketBreadth } from '../lib/market-breadth.ts';
import { parseIndexConstituents } from '../lib/psx-market.ts';

const row = (symbol, price, change, volume) => ({ symbol, price, change, volume });

test('counts advances, declines and unchanged from one dataset', () => {
  const b = marketBreadth([row('A', 10, 1, 100), row('B', 10, -1, 200), row('C', 10, 0, 50)]);
  assert.deepEqual([b.advances, b.declines, b.unchanged, b.volume, b.covered], [1, 1, 1, 350, 3]);
});

test('missing or invalid values are excluded, never counted as zero', () => {
  const b = marketBreadth([row('A', null, 1, 100), row('B', 10, null, 100), row('C', 0, 1, 1), row('D', 10, NaN, 1), row('E', 10, 1, null)]);
  assert.equal(b.covered, 1);
  assert.equal(b.excluded, 4);
  assert.equal(b.unchanged, 0, 'a missing change is not "unchanged"');
  assert.equal(b.volumeMissing, 1);
  assert.equal(b.volume, 0);
});

test('duplicate symbols are counted once and an empty table yields zeros', () => {
  assert.equal(marketBreadth([row('A', 10, 1, 1), row('A', 10, -1, 1)]).sourceRows, 1);
  assert.deepEqual(marketBreadth([]), { advances: 0, declines: 0, unchanged: 0, volume: 0, covered: 0, sourceRows: 0, excluded: 0, volumeMissing: 0 });
});

test('real All-Share table: every counted row reconciles', () => {
  const rows = parseIndexConstituents(readFileSync(new URL('./fixtures/psx-allshr-full.html', import.meta.url), 'utf8'));
  const b = marketBreadth(rows);
  assert.ok(b.sourceRows > 50);
  assert.equal(b.advances + b.declines + b.unchanged, b.covered);
  assert.equal(b.covered + b.excluded, b.sourceRows);
});
