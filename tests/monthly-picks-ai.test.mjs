import test from 'node:test';
import assert from 'node:assert/strict';
import { quantResult } from '../lib/monthly-picks-ai.ts';

function metrics(overrides = {}) {
  return {
    ticker: 'AAA', name: 'Alpha', peTtm: 10, earningsYieldPct: 10, epsTtm: 5, epsYoYPct: 12,
    epsAnnualCagrPct: 8, netMarginTrendPct: 2, pricePositionPct: 50, change1yPct: 15,
    mostRecentAnnouncement: { date: 'Sep 1, 2026', title: 'Financial Results', category: 'Financial Results', url: 'https://dps.psx.com.pk/download/document/1.pdf', ageDays: 20 },
    recentAnnouncements: [{ date: 'Sep 1, 2026', title: 'Financial Results', category: 'Financial Results', url: 'https://dps.psx.com.pk/download/document/1.pdf' }],
    dataGaps: [], ...overrides,
  };
}
function snapshot() {
  return {
    generatedOn: '2026-09-25', contributionMonth: '2026-10', freshMoneyPkr: 100000,
    shortlist: ['AAA', 'BBB', 'ZZZZ'], dataAsOf: '2026-09-25',
    companies: [
      { ticker: 'AAA', name: 'Alpha', sector: 'CEMENT', source: 'https://dps.psx.com.pk/company/AAA', price: 100, priceDate: '2026-09-25', metrics: metrics({ ticker: 'AAA', name: 'Alpha' }) },
      { ticker: 'BBB', name: 'Beta', sector: 'BANKS', source: 'https://dps.psx.com.pk/company/BBB', price: 200, priceDate: '2026-09-25', metrics: metrics({ ticker: 'BBB', name: 'Beta', epsYoYPct: -5, change1yPct: -3 }) },
      { ticker: 'ZZZZ', name: 'ZZZZ', sector: 'Unknown', source: null, price: null, priceDate: null, metrics: metrics({ ticker: 'ZZZZ', name: 'ZZZZ', unavailable: 'PSX fetch failed (520)', peTtm: null, earningsYieldPct: null, epsYoYPct: null, mostRecentAnnouncement: null, recentAnnouncements: [], dataGaps: ['PSX data unavailable: PSX fetch failed (520)'] }) },
    ],
    scores: [
      { ticker: 'AAA', score: 80, confidence: 'High', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: metrics({ ticker: 'AAA' }) },
      { ticker: 'BBB', score: 60, confidence: 'Medium', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: metrics({ ticker: 'BBB' }) },
      { ticker: 'ZZZZ', score: 0, confidence: 'Low', components: {}, evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: metrics({ ticker: 'ZZZZ', unavailable: 'PSX fetch failed (520)' }) },
    ],
  };
}

test('quantResult always produces a complete result with no AI call', () => {
  const result = quantResult(snapshot());
  assert.equal(result.method, 'quant');
  assert.equal(result.coverage.length, 3);
  assert.equal(result.picks[0].ticker, 'AAA', 'AAA scores highest and should be the top pick');
  const total = result.picks.reduce((sum, p) => sum + p.allocationPct, 0) + result.unallocatedPct;
  assert.ok(Math.abs(total - 100) < 0.01);
});

test('quantResult produces cash-only output when nothing clears the threshold', () => {
  const empty = snapshot();
  empty.scores = empty.scores.map((s) => ({ ...s, score: 10 }));
  const result = quantResult(empty);
  assert.deepEqual(result.picks, []);
  assert.equal(result.unallocatedPct, 100);
  assert.match(result.marketOutlook, /No shortlisted company/);
});

test('the ranking carries no model or provider identifiers and states it ran on the device', () => {
  const text = JSON.stringify(quantResult(snapshot()));
  assert.ok(!/openai|gpt-/i.test(text));
  assert.match(quantResult(snapshot()).marketOutlook, /calculated on this device/);
});
