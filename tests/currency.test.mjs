import assert from 'node:assert/strict';
import test from 'node:test';
import { currencyFlows, currencyPosition, valueCurrency } from '../lib/currency.ts';
import { validateAssets, valueAsset } from '../lib/assets.ts';

const entry = (id, date, type, units, pkr) => ({ id, date, type, units, pkr, note: '' });
const usd = (entries) => ({ id: 'usd', kind: 'currency', name: 'Dollars', currency: 'USD', note: '', entries });
const rate = (kind, date, pkrPerUnit) => ({ date, currency: 'USD', kind, pkrPerUnit, sourceUrl: 'x', fetchedAt: 'x' });

test('selling removes units at the average rupee cost and records the gain', () => {
  const asset = usd([entry('a', '2026-01-01', 'buy', 100, 28000), entry('b', '2026-02-01', 'buy', 100, 28400), entry('c', '2026-03-01', 'sell', 50, 14500)]);
  const p = currencyPosition(asset);
  assert.equal(p.units, 150);
  // Average cost is 282 a dollar; 50 dollars cost 14,100 and were sold for 14,500.
  assert.equal(p.realized, 400);
  assert.equal(p.cost, 56400 - 14100);
  assert.deepEqual(currencyFlows(asset).map((f) => f.amount), [28000, 28400, -14500]);
});

test('a sale larger than the holding throws, an unknown opening cost stays unknown', () => {
  assert.throws(() => currencyPosition(usd([entry('a', '2026-01-01', 'buy', 10, 2800), entry('b', '2026-01-02', 'sell', 11, 3000)])), /exceeds/);
  const p = currencyPosition(usd([entry('a', '2026-01-01', 'opening', 10, null)]));
  assert.equal(p.cost, null);
  assert.equal(p.averageRate, null);
});

test('value uses the chosen rate and the gain follows the rupee', () => {
  const asset = usd([entry('a', '2026-01-01', 'buy', 100, 28000)]);
  const v = valueCurrency(asset, [rate('open_market', '2026-10-17', 282)], '2026-10-17');
  assert.equal(v.value, 28200);
  assert.equal(v.gain, 200);
  assert.equal(valueCurrency(asset, [], '2026-10-17').value, null);
  const av = valueAsset(asset, [], '2026-10-17', [], [], [rate('interbank', '2026-10-17', 282)]);
  assert.equal(av.classKey, 'currency');
  assert.equal(av.estimated, true);
  assert.equal(av.open, true);
});

test('validation rejects bad currencies, future dates and zero amounts', () => {
  const ok = usd([entry('a', '2026-01-01', 'buy', 10, 2800)]);
  assert.doesNotThrow(() => validateAssets([ok], '2026-10-17'));
  assert.throws(() => validateAssets([{ ...ok, currency: 'EUR' }], '2026-10-17'), /dollar/);
  assert.throws(() => validateAssets([usd([entry('a', '2027-01-01', 'buy', 10, 2800)])], '2026-10-17'), /future/);
  assert.throws(() => validateAssets([usd([entry('a', '2026-01-01', 'buy', 0, 2800)])], '2026-10-17'), /greater than zero/);
  assert.throws(() => validateAssets([usd([entry('a', '2026-01-01', 'buy', 5, null)])], '2026-10-17'), /unknown cost/);
});
