// tests/valuation.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scenarioValue, scenarioValues, findScenario, resolveValuation,
  upsideDownsidePct, discountToValuePct,
} from '../lib/valuation.ts';

test('scenario value requires finite positive EPS and multiple, else unavailable with a reason', () => {
  assert.equal(scenarioValue({ name: 'Base', eps: 8, multiple: 16 }).value, 128);
  assert.equal(scenarioValue({ name: 'Base', eps: null, multiple: 16 }).value, null);
  assert.match(scenarioValue({ name: 'Base', eps: null, multiple: 16 }).reason, /EPS/);
  assert.equal(scenarioValue({ name: 'Base', eps: 8, multiple: null }).value, null);
  assert.match(scenarioValue({ name: 'Base', eps: 8, multiple: null }).reason, /multiple/);
  assert.equal(scenarioValue({ name: 'Base', eps: 0, multiple: 16 }).value, null);
  assert.equal(scenarioValue({ name: 'Base', eps: -5, multiple: 16 }).value, null);
  assert.equal(scenarioValue({ name: 'Base', eps: 8, multiple: 16 }).reason, null);
});

test('findScenario matches by name case-insensitively regardless of array position', () => {
  const values = scenarioValues([
    { name: 'Bull', eps: 12, multiple: 19 },
    { name: 'bear', eps: 8, multiple: 13 },
    { name: 'BASE', eps: 10, multiple: 16 },
  ]);
  assert.equal(findScenario(values, 'Bear')?.value, 104);
  assert.equal(findScenario(values, 'Base')?.value, 160);
  assert.equal(findScenario(values, 'Bull')?.value, 228);
});

test('legacy EFERT-style scenarios (13x8, 16x10, 19x12) resolve to 104/160/228 with scenario-model provenance', () => {
  const summary = resolveValuation({
    scenarios: [
      { name: 'Bear', eps: 8, multiple: 13 },
      { name: 'Base', eps: 10, multiple: 16 },
      { name: 'Bull', eps: 12, multiple: 19 },
    ],
    legacyLow: null, legacyBase: null, legacyHigh: null,
  });
  assert.deepEqual([summary.low, summary.base, summary.high], [104, 160, 228]);
  assert.equal(summary.provenance, 'scenario-model');
});

test('a partially specified scenario model leaves only its missing case null, never falls back to legacy for that case', () => {
  const summary = resolveValuation({
    scenarios: [
      { name: 'Bear', eps: 8, multiple: 13 },
      { name: 'Base', eps: null, multiple: null },
      { name: 'Bull', eps: 12, multiple: 19 },
    ],
    legacyLow: 50, legacyBase: 999, legacyHigh: 300,
  });
  assert.equal(summary.low, 104);
  assert.equal(summary.base, null);
  assert.equal(summary.high, 228);
  assert.equal(summary.provenance, 'scenario-model');
});

test('no scenario model falls back to legacy explicit values, labelled legacy', () => {
  const summary = resolveValuation({ scenarios: [], legacyLow: 90, legacyBase: 120, legacyHigh: 150 });
  assert.deepEqual([summary.low, summary.base, summary.high], [90, 120, 150]);
  assert.equal(summary.provenance, 'legacy');
});

test('no scenario model and no legacy values is unavailable, not zero', () => {
  const summary = resolveValuation({});
  assert.deepEqual([summary.low, summary.base, summary.high], [null, null, null]);
  assert.equal(summary.provenance, 'unavailable');
});

test('upside/downside uses (value/price-1)*100; base 500 vs price 550.98 is about -9.25%, never called upside when negative', () => {
  assert.equal(upsideDownsidePct(500, 550.98), -9.25);
  assert.equal(upsideDownsidePct(600, 500), 20);
  assert.equal(upsideDownsidePct(null, 500), null);
  assert.equal(upsideDownsidePct(500, null), null);
  assert.equal(upsideDownsidePct(500, 0), null);
});

test('discount to value divides by value, not price, and is distinct from upside', () => {
  assert.equal(discountToValuePct(500, 550.98), round550());
  assert.equal(discountToValuePct(null, 500), null);
  assert.equal(discountToValuePct(500, 500), 0);
  function round550() { return Math.round(((500 - 550.98) / 500) * 100 * 100) / 100; }
});
