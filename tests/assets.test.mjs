import test from 'node:test';
import assert from 'node:assert/strict';
import { metalPosition, valueMetal, validateAssets, metalFlows } from '../lib/assets.ts';
import { chooseRate, parseGoldPage, tolaFromSpot, TOLA_GRAMS } from '../lib/metal-rates.ts';

const entry = (id, type, date, grams, amount, extra = {}) => ({ id, type, date, grams, amount, note: '', ...extra });
const gold = (entries, karat = 24) => ({ id: 'g1', kind: 'metal', name: 'Gold coins', metal: 'gold', karat, note: '', entries });
const row = (date, kind, pkrPerTola, metal = 'gold') => ({ date, metal, kind, pkrPerTola, sourceUrl: 'https://example.test', fetchedAt: date + 'T08:00:00Z' });

test('history keeps every purchase and sale; sales use average cost', () => {
  const a = gold([entry('1', 'buy', '2025-01-01', 10, 100000), entry('2', 'buy', '2025-02-01', 10, 120000), entry('3', 'sell', '2025-03-01', 5, 70000)]);
  const p = metalPosition(a);
  assert.equal(p.grams, 15);
  assert.equal(p.cost, 165000); // 220000 - 5 * 11000
  assert.equal(p.realized, 15000); // 70000 - 5 * 11000
  assert.deepEqual(p.history.map((h) => h.heldAfter), [10, 20, 15]);
  assert.equal(p.history[2].realizedGain, 15000);
  assert.deepEqual(p.bought, { grams: 20, amount: 220000 });
  assert.deepEqual(p.sold, { grams: 5, amount: 70000 });
});

test('an oversell is rejected and a voided entry is skipped', () => {
  assert.throws(() => metalPosition(gold([entry('1', 'buy', '2025-01-01', 5, 1), entry('2', 'sell', '2025-02-01', 6, 1)])), /exceeds/);
  const p = metalPosition(gold([entry('1', 'buy', '2025-01-01', 5, 100), entry('2', 'buy', '2025-02-01', 5, 100, { voided: true })]));
  assert.equal(p.grams, 5);
});

test('unknown opening cost stays unknown, not zero', () => {
  const a = gold([entry('1', 'opening', '2024-01-01', 10, null)]);
  const v = valueMetal(a, [row('2026-10-05', 'local', 436000)], '2026-10-06');
  assert.equal(v.cost, null);
  assert.equal(v.gain, null);
  assert.ok(v.value > 0);
});

test('value is grams x rate x purity', () => {
  const v = valueMetal(gold([entry('1', 'buy', '2025-01-01', TOLA_GRAMS, 400000)], 22), [row('2026-10-06', 'local', 436000)], '2026-10-06');
  assert.equal(v.value, Math.round(436000 * (22 / 24) * 100) / 100);
  assert.ok(Math.abs(v.gain - (v.value - 400000)) < 0.01);
});

test('local rate wins when fresh, international when the local one is old, and nothing is not zero', () => {
  const rows = [row('2026-10-01', 'local', 430000), row('2026-10-06', 'international', 420000)];
  assert.equal(chooseRate(rows, 'gold', '2026-10-06').kind, 'international');
  assert.equal(chooseRate(rows, 'gold', '2026-10-06').fellBack, true);
  assert.equal(chooseRate([row('2026-10-05', 'local', 436000), ...rows], 'gold', '2026-10-06').kind, 'local');
  assert.equal(chooseRate(rows, 'silver', '2026-10-06'), null);
  const none = valueMetal(gold([entry('1', 'buy', '2025-01-01', 10, 1)]), [], '2026-10-06');
  assert.equal(none.value, null);
});

test('gold page parser needs both prices and rejects a mismatch', () => {
  const ok = '<h3>24K per Tola</h3><p>Rs. 436,000.00</p><h3>24K per 10 Gram</h3><p>Rs. 373,810.00</p>';
  assert.deepEqual(parseGoldPage(ok), { pkrPerTola: 436000 });
  assert.equal(parseGoldPage(ok.replace('373,810', '300,000')), null);
  const labelFirst = '<div>24 Karat Gold Rate (1 Tola)</div><b>Rs. 436000.00</b><div>24 Karat Gold Rate (10 Gram)</div><b>Rs. 373810.00</b>';
  assert.deepEqual(parseGoldPage(labelFirst), { pkrPerTola: 436000 });
  const amountFirst = '<b>Rs. 436000.00</b><span>24 Karat Gold Rate (1 Tola)</span><b>Rs. 373810.00</b><span>24 Karat Gold Rate (10 Gram)</span>';
  assert.deepEqual(parseGoldPage(amountFirst), { pkrPerTola: 436000 });
  assert.equal(parseGoldPage('<p>nothing</p>'), null);
  assert.ok(Math.abs(tolaFromSpot(4173.3, 280) - 438_000) < 15_000);
});

test('validation rejects bad weights, future dates and unknown cost on a purchase', () => {
  const today = '2026-10-06';
  assert.doesNotThrow(() => validateAssets([gold([entry('1', 'buy', '2025-01-01', 10, 1)])], today));
  assert.throws(() => validateAssets([gold([entry('1', 'buy', '2027-01-01', 10, 1)])], today), /future/);
  assert.throws(() => validateAssets([gold([entry('1', 'buy', '2025-01-01', 0, 1)])], today), /weight/);
  assert.throws(() => validateAssets([gold([entry('1', 'buy', '2025-01-01', 1, null)])], today), /unknown cost/);
});

test('flows are money in positive and sale proceeds negative', () => {
  const f = metalFlows(gold([entry('1', 'buy', '2025-01-01', 10, 100), entry('2', 'sell', '2025-02-01', 5, 70)]));
  assert.deepEqual(f.map((x) => x.amount), [100, -70]);
});
