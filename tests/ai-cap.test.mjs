import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aiCapCheck,
  parseAiCap,
  pktMonthStartIso,
  DEFAULT_AI_MONTHLY_CAP_USD,
} from '../lib/monthly-picks-flow.ts';

test('PKT month start is midnight Karachi time on the 1st, as a UTC timestamp', () => {
  assert.equal(pktMonthStartIso(new Date('2026-09-30T06:00:00Z')), '2026-08-31T19:00:00.000Z');
  // 21:00 UTC on 31 Aug is already 1 Sep in Karachi.
  assert.equal(pktMonthStartIso(new Date('2026-08-31T21:00:00Z')), '2026-08-31T19:00:00.000Z');
  assert.equal(pktMonthStartIso(new Date('2026-01-01T02:00:00Z')), '2025-12-31T19:00:00.000Z');
});

test('parseAiCap reads the Worker var and falls back to the default', () => {
  assert.equal(parseAiCap('2.5'), 2.5);
  assert.equal(parseAiCap('0'), 0);
  assert.equal(parseAiCap(undefined), DEFAULT_AI_MONTHLY_CAP_USD);
  assert.equal(parseAiCap(''), DEFAULT_AI_MONTHLY_CAP_USD);
  assert.equal(parseAiCap('-1'), DEFAULT_AI_MONTHLY_CAP_USD);
  assert.equal(parseAiCap('lots'), DEFAULT_AI_MONTHLY_CAP_USD);
});

test('a call is allowed only while spend plus its reserve fits the cap', () => {
  assert.equal(aiCapCheck(0, 0.112, 1).allowed, true);
  assert.equal(aiCapCheck(0.888, 0.112, 1).allowed, true);
  assert.equal(aiCapCheck(0.9, 0.112, 1).allowed, false);
  assert.equal(aiCapCheck(0, 0.112, 0).allowed, false);
});

test('the refusal explains the cap and what was spent', () => {
  const check = aiCapCheck(0.95, 0.112, 1);
  assert.match(check.message, /\$1\.00 monthly AI limit/);
  assert.match(check.message, /\$0\.95/);
  assert.match(check.message, /quantitative/i);
});

test('a capped run falls back to the quant result and says why', async () => {
  const { quantResult } = await import('../lib/monthly-picks-ai.ts');
  const snapshot = { generatedOn: '2026-09-30', contributionMonth: '2026-09', freshMoneyPkr: 1000, shortlist: [], dataAsOf: '2026-09-30', companies: [], scores: [] };
  const reason = aiCapCheck(0.95, 0.112, 1).message;
  const result = quantResult(snapshot, reason);
  assert.equal(result.method, 'quant');
  assert.equal(result.fallbackReason, reason);
  assert.ok(result.marketOutlook.startsWith(reason));
  assert.equal(quantResult(snapshot).fallbackReason, undefined);
});
