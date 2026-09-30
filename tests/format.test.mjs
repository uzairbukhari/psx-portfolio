import test from 'node:test';
import assert from 'node:assert/strict';
import { pkr, pkrCompact, pct, signedPkr, shares, num } from '../lib/format.ts';

test('pkr formats and treats null as unknown', () => {
  assert.match(pkr(1234.5), /1,234\.5/);
  assert.equal(pkr(null), 'Unknown');
  assert.equal(pkr(undefined), 'Unknown');
});
test('pkrCompact uses lakh and crore', () => {
  assert.equal(pkrCompact(250000), 'PKR 2.5 lakh');
  assert.equal(pkrCompact(12500000), 'PKR 1.25 crore');
  assert.equal(pkrCompact(-12500000), '-PKR 1.25 crore');
  assert.match(pkrCompact(999), /999/);
});
test('pct signs and handles unknown', () => {
  assert.equal(pct(12.345, { sign: true }), '+12.3%');
  assert.equal(pct(-2, { sign: true }), '−2.0%');
  assert.equal(pct(0, { sign: true }), '0.0%');
  assert.equal(pct(null), '—');
  assert.equal(pct(5, { digits: 2 }), '5.00%');
});
test('signedPkr shows explicit sign', () => {
  assert.match(signedPkr(1000), /^\+/);
  assert.match(signedPkr(-1000), /^−/);
  assert.equal(signedPkr(null), 'Unknown');
});
test('shares and num group digits', () => {
  assert.equal(shares(1234567), '1,234,567');
  assert.equal(shares(null), '—');
  assert.equal(num(1234.567), '1,234.57');
});
