import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMetrics, quantScore } from '../lib/company-facts.ts';
import { sanitizePicks } from '../lib/monthly-picks-ai.ts';

const ASOF = '2026-09-25';
const q = (period, eps) => ({ period, revenue: null, pat: null, eps });
const baseFacts = (over = {}) => ({
  ticker: 'AAA', name: 'Alpha', sector: 'X', price: 100, priceDate: ASOF, peTtm: 10,
  week52: { low: 50, high: 150 }, change1y: 10, changeYtd: 5, marketCapThousands: 1, freeFloatPct: 20,
  annual: [], quarterly: [], ratios: { grossMargin: [], netMargin: [], epsGrowth: [], peg: [] },
  announcements: [], source: 'https://dps.psx.com.pk/company/AAA', fetchedAt: `${ASOF}T10:00:00Z`, ...over,
});
const m = (over) => ({
  ticker: 'T', name: 'T', peTtm: 10, earningsYieldPct: 10, epsTtm: 5, epsYoYPct: 10, epsAnnualCagrPct: 8,
  netMarginTrendPct: 1, pricePositionPct: 50, change1yPct: 10, mostRecentAnnouncement: null,
  recentAnnouncements: [], dataGaps: [], ...over,
});

test('equal metrics score equally regardless of input order', () => {
  const a = m({ ticker: 'AAA' }), b = m({ ticker: 'BBB' }), c = m({ ticker: 'CCC', earningsYieldPct: 2 });
  const one = quantScore([a, b, c]), two = quantScore([c, b, a]);
  const by = (list, t) => list.find((s) => s.ticker === t).score;
  assert.equal(by(one, 'AAA'), by(one, 'BBB'));
  assert.equal(by(two, 'AAA'), by(two, 'BBB'));
  assert.equal(by(one, 'AAA'), by(two, 'AAA'));
});

test('missing metrics do not earn a neutral 50th percentile', () => {
  const full = m({ ticker: 'FULL', earningsYieldPct: 20, epsYoYPct: 30, epsAnnualCagrPct: 30, netMarginTrendPct: 5, change1yPct: 40 });
  const weak = m({ ticker: 'WEAK', earningsYieldPct: 1, epsYoYPct: -30, epsAnnualCagrPct: null, netMarginTrendPct: -5, change1yPct: -40 });
  const sparse = m({ ticker: 'NONE', earningsYieldPct: null, epsYoYPct: null, epsAnnualCagrPct: null, netMarginTrendPct: null, change1yPct: null });
  const scores = quantScore([full, weak, sparse]);
  const sp = scores.find((s) => s.ticker === 'NONE');
  assert.ok(sp.score <= scores.find((s) => s.ticker === 'WEAK').score, 'no data must not beat bad data');
  assert.equal(sp.evidence.completeness, 0);
  assert.equal(sp.confidence, 'Low');
});

test('confidence reflects evidence completeness, not only score', () => {
  const lone = m({ ticker: 'LONE', earningsYieldPct: 30, epsYoYPct: null, epsAnnualCagrPct: null, netMarginTrendPct: null, change1yPct: null });
  const peer = m({ ticker: 'PEER', earningsYieldPct: 5 });
  const s = quantScore([lone, peer]).find((x) => x.ticker === 'LONE');
  assert.notEqual(s.confidence, 'High');
});

test('zero latest-quarter EPS is a real value, not missing', () => {
  const facts = baseFacts({ quarterly: [q('Q3 2026', 0), q('Q2 2026', 1), q('Q1 2026', 1), q('Q4 2025', 1), q('Q3 2025', 2)] });
  assert.equal(computeMetrics(facts, ASOF).epsYoYPct, -100);
});

test('zero prior-year EPS leaves growth unavailable, never infinite', () => {
  const facts = baseFacts({ quarterly: [q('Q3 2026', 1), q('Q2 2026', 1), q('Q1 2026', 1), q('Q4 2025', 1), q('Q3 2025', 0)] });
  assert.equal(computeMetrics(facts, ASOF).epsYoYPct, null);
});

test('annual CAGR uses elapsed reporting years, not the count of positive rows', () => {
  // 2026=16, 2025=-5 (loss, excluded), 2024=8, 2023=4: 16/4 over 3 elapsed years.
  const facts = baseFacts({ annual: [q('2026', 16), q('2025', -5), q('2024', 8), q('2023', 4)] });
  const expected = Math.round((Math.pow(16 / 4, 1 / 3) - 1) * 10000) / 100;
  assert.equal(computeMetrics(facts, ASOF).epsAnnualCagrPct, expected);
});

test('annual CAGR is unavailable when the earliest year is not positive', () => {
  const facts = baseFacts({ annual: [q('2026', 16), q('2025', 8), q('2024', 4), q('2023', -1)] });
  assert.equal(computeMetrics(facts, ASOF).epsAnnualCagrPct, null);
});

test('TTM EPS requires four consecutive quarters; duplicates and gaps give null', () => {
  const dup = baseFacts({ quarterly: [q('Q3 2026', 1), q('Q3 2026', 1), q('Q2 2026', 1), q('Q1 2026', 1)] });
  assert.equal(computeMetrics(dup, ASOF).epsTtm, null);
  const gap = baseFacts({ quarterly: [q('Q3 2026', 1), q('Q2 2026', 1), q('Q4 2025', 1), q('Q3 2025', 1)] });
  assert.equal(computeMetrics(gap, ASOF).epsTtm, null);
  const ok = baseFacts({ quarterly: [q('Q3 2026', 1), q('Q2 2026', 2), q('Q1 2026', 3), q('Q4 2025', 4)] });
  assert.equal(computeMetrics(ok, ASOF).epsTtm, 10);
});

test('cumulative-looking quarters are not summed', () => {
  // Q1<Q2<Q3 strictly cumulative pattern with identical period prefixes is ambiguous only when periods are labelled 6M/9M.
  const facts = baseFacts({ quarterly: [q('9M 2026', 9), q('6M 2026', 6), q('3M 2026', 3), q('Q4 2025', 2)] });
  assert.equal(computeMetrics(facts, ASOF).epsTtm, null);
});

function snap() {
  const metrics = m({ ticker: 'AAA', name: 'Alpha', mostRecentAnnouncement: { date: 'Sep 1, 2026', title: 'x', category: 'Others', url: 'https://dps.psx.com.pk/a.pdf', ageDays: 3 }, recentAnnouncements: [] });
  return {
    generatedOn: ASOF, contributionMonth: '2026-10', freshMoneyPkr: 1e5, shortlist: ['AAA'], dataAsOf: ASOF,
    companies: [{ ticker: 'AAA', name: 'Alpha', sector: 'X', source: 'https://dps.psx.com.pk/company/AAA', price: 100, priceDate: ASOF, metrics }],
    scores: [{ ticker: 'AAA', score: 70, confidence: 'Medium', components: {}, metrics }],
  };
}

test('a valid 100%-cash AI answer is a successful result, not a rejection', () => {
  const raw = { marketOutlook: 'Hold cash.', picks: [], coverage: [{ ticker: 'AAA', outlook: 'Neutral', summary: 'Fair.' }], unallocatedPct: 100 };
  const result = sanitizePicks(raw, snap());
  assert.ok(result, 'cash-only result must survive');
  assert.equal(result.picks.length, 0);
  assert.equal(result.unallocatedPct, 100);
  assert.equal(result.method, 'ai');
});

test('an AI answer whose picks are all invalid is still rejected', () => {
  const raw = { marketOutlook: 'x', picks: [{ ticker: 'NOPE', allocationPct: 50, confidence: 'High', thesis: 'x' }], coverage: [], unallocatedPct: 50 };
  assert.equal(sanitizePicks(raw, snap()), null);
});

test('share estimates need a price from the latest completed session, not any price under 7 days old', async () => {
  const { estimateMonthlyPicks } = await import('../lib/monthly-picks.ts');
  const result = { marketOutlook: 'x', picks: [{ ticker: 'AAA', name: 'A', allocationPct: 20, confidence: 'High', thesis: 't', catalysts: [], risks: [], sourceUrls: [], evidenceStatus: 'ready' }], coverage: [], unallocatedPct: 80 };
  const quote = (date) => ({ quotes: { AAA: { price: 100, asOf: 'x', date, source: 's', fetchedAt: `${date}T10:00:00Z` } } });
  const now = new Date('2026-09-23T06:00:00Z'); // Wednesday 11:00 PKT; Tuesday 22nd is the latest completed session
  assert.notEqual(estimateMonthlyPicks(result, quote('2026-09-22'), 100000, 0, now)[0].shares, null, 'last close is current');
  assert.equal(estimateMonthlyPicks(result, quote('2026-09-18'), 100000, 0, now)[0].shares, null, 'a 5-day-old price is stale');
});
