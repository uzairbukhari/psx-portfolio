import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEod, parseIntraday, sliceRange, rangeChange } from '../lib/price-history.ts';

const DAY = 86_400;
test('parseEod sorts chronologically and drops bad rows', () => {
  const out = parseEod([[300, 3, 1, 3], [100, 1, 1, 1], [200, 0, 1, 1], [NaN, 5, 1, 1]]);
  assert.deepEqual(out, [[100, 1], [300, 3]]);
});
test('parseIntraday downsamples keeping first and last', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [1000 - i, 10 + i]);
  const out = parseIntraday(rows, 50);
  assert.equal(out.length, 50);
  assert.equal(out[0][0], 1);
  assert.equal(out.at(-1)[0], 1000);
});
test('sliceRange windows eod from the last point', () => {
  const eod = Array.from({ length: 400 }, (_, i) => [i * DAY, 100 + i]);
  assert.equal(sliceRange(eod, [], '7d').length, 8);
  assert.equal(sliceRange(eod, [[1, 2]], 'today').length, 1);
  assert.ok(sliceRange(eod, [], '1y').length <= 367);
  assert.deepEqual(sliceRange([], [], '1m'), []);
});
test('rangeChange', () => {
  assert.equal(rangeChange([[1, 100]]), null);
  assert.equal(rangeChange([[1, 100], [2, 110]]).percent, 10);
});
