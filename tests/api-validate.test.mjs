import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecommendationRun, parseRecommendationList, pollIntervalMs } from '../lib/api-validate.ts';

const run = (over = {}) => ({ id: 'r', month: '2026-10', amount: 1000, feePct: 0, shortlist: ['A'], status: 'gathering', result: null, error: null, progress: { pending: [], percent: 20 }, ...over });

test('accepts a well-formed run and an old-server run without the additive progress fields', () => {
  assert.ok(parseRecommendationRun(run()));
  assert.ok(parseRecommendationRun(run({ progress: { phase: 'ranking', pending: [], startedAt: 'x' } })));
});
test('rejects malformed runs instead of rendering them', () => {
  assert.equal(parseRecommendationRun(null), null);
  assert.equal(parseRecommendationRun(run({ status: 'bogus' })), null);
  assert.equal(parseRecommendationRun(run({ amount: 'x' })), null);
  assert.equal(parseRecommendationRun(run({ progress: { pending: [], percent: 140 } })), null);
  assert.equal(parseRecommendationRun(run({ result: { picks: 'no' } })), null);
});
test('a list with one bad run is rejected as a whole', () => {
  assert.equal(parseRecommendationList({ recommendations: [run(), run({ id: 5 })] }), null);
  assert.equal(parseRecommendationList({ recommendations: [run()] }).backgroundProcessing, false);
});
test('polling is 5 s for the first minute then 15 s', () => {
  assert.equal(pollIntervalMs(0), 5000);
  assert.equal(pollIntervalMs(59_999), 5000);
  assert.equal(pollIntervalMs(60_000), 15000);
});
