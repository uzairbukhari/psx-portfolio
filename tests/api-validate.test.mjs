import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicAnalysis, pollIntervalMs } from '../lib/api-validate.ts';

const analysis = (over = {}) => ({
  dataAsOf: '2026-10-03', companies: [{ ticker: 'A', metrics: {} }], scores: [{ ticker: 'A' }],
  facts: [{ ticker: 'A', state: 'fresh' }], index: null, dispatchEnabled: true, ...over,
});

test('accepts a well-formed analysis and defaults the freshness limit', () => {
  const parsed = parsePublicAnalysis(analysis());
  assert.ok(parsed);
  assert.equal(parsed.factsMaxAgeDays, 7);
  assert.equal(parsed.dispatchEnabled, true);
});
test('rejects malformed analyses instead of rendering them', () => {
  assert.equal(parsePublicAnalysis(null), null);
  assert.equal(parsePublicAnalysis(analysis({ companies: 'no' })), null);
  assert.equal(parsePublicAnalysis(analysis({ companies: [{ ticker: 5, metrics: {} }] })), null);
  assert.equal(parsePublicAnalysis(analysis({ facts: [{ ticker: 'A' }] })), null);
});
test('polling is 5 s for the first minute then 15 s', () => {
  assert.equal(pollIntervalMs(0), 5000);
  assert.equal(pollIntervalMs(59_999), 5000);
  assert.equal(pollIntervalMs(60_000), 15000);
});
