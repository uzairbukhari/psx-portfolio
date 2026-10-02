import assert from 'node:assert/strict';
import test from 'node:test';
import { constrainAllocations } from '../lib/allocation.ts';
import { quantAllocation } from '../lib/company-facts.ts';
import { sanitizePicks, quantResult } from '../lib/monthly-picks-ai.ts';

const total = (r) => Math.round((r.allocations.reduce((a, x) => a + x.allocationPct, 0) + r.cashPct) * 100) / 100;
const pct = (r, t) => r.allocations.find((x) => x.ticker === t)?.allocationPct;
const w = (ticker, weight) => ({ ticker, weight });

test('a single surviving company is capped at 35% and the rest stays cash', () => {
  const r = constrainAllocations([w('A', 100)], 0, 35);
  assert.equal(pct(r, 'A'), 35);
  assert.equal(r.cashPct, 65);
  assert.equal(total(r), 100);
});

test('capped excess is redistributed pro rata to the others, preserving their relative sizes', () => {
  const r = constrainAllocations([w('A', 60), w('B', 30), w('C', 10)], 0, 35);
  assert.equal(pct(r, 'A'), 35);
  assert.equal(pct(r, 'B'), 35);
  // B would exceed the cap too, so it is capped and C takes what is left under the cap.
  assert.equal(pct(r, 'C'), 30);
  assert.equal(r.cashPct, 0);
  assert.equal(total(r), 100);
});

test('relative proportions are kept when nothing needs capping', () => {
  const r = constrainAllocations([w('A', 30), w('B', 20), w('C', 10)], 40, 35);
  assert.equal(pct(r, 'A'), 30);
  assert.equal(pct(r, 'B'), 20);
  assert.equal(pct(r, 'C'), 10);
  assert.equal(r.cashPct, 40);
});

test('malformed totals are scaled so allocations plus cash equal 100', () => {
  const r = constrainAllocations([w('A', 50), w('B', 50), w('C', 50), w('D', 50)], 100, 35);
  assert.equal(total(r), 100);
  for (const a of r.allocations) assert.ok(a.allocationPct <= 35 + 1e-9);
  const low = constrainAllocations([w('A', 10), w('B', 10)], 0, 35);
  assert.equal(pct(low, 'A'), 35);
  assert.equal(low.cashPct, 30);
  assert.equal(total(low), 100);
});

test('NaN or negative cash falls back to the unallocated remainder', () => {
  for (const cash of [NaN, -5, undefined]) {
    const r = constrainAllocations([w('A', 20), w('B', 20)], cash, 35);
    assert.equal(total(r), 100);
    assert.equal(pct(r, 'A'), 20);
    assert.equal(r.cashPct, 60);
  }
});

test('no positive weights is a cash-only outcome', () => {
  const r = constrainAllocations([], 0, 35);
  assert.deepEqual(r.allocations, []);
  assert.equal(r.cashPct, 100);
  const zero = constrainAllocations([w('A', 0), w('B', -3), w('C', NaN)], 10, 35);
  assert.deepEqual(zero.allocations, []);
  assert.equal(zero.cashPct, 100);
});

test('rounding never pushes the total off 100 or a pick over the cap', () => {
  for (let i = 0; i < 300; i++) {
    const n = 1 + (i % 5);
    const weights = Array.from({ length: n }, (_, j) => w('T' + j, ((i * 7 + j * 13) % 97) + 0.137));
    const r = constrainAllocations(weights, (i * 3) % 40, 35);
    assert.ok(Math.abs(total(r) - 100) <= 0.011, `total ${total(r)}`);
    for (const a of r.allocations) assert.ok(a.allocationPct <= 35 && a.allocationPct >= 0, `pick ${a.allocationPct}`);
    assert.ok(r.cashPct >= 0);
  }
});

const metrics = (extra = {}) => ({ unavailable: null, recentAnnouncements: [], mostRecentAnnouncement: null, dataGaps: [], peTtm: 10, earningsYieldPct: 10, epsYoYPct: 5, change1yPct: 5, ...extra });
const company = (ticker) => ({ ticker, name: ticker, sector: 'Bank', source: `https://dps.psx.com.pk/company/${ticker}`, price: 100, priceDate: '2026-09-30', metrics: metrics() });
const snapshot = (tickers) => ({
  generatedOn: '2026-09-30', contributionMonth: '2026-10', freshMoneyPkr: 100000, shortlist: tickers, dataAsOf: '2026-09-30',
  companies: tickers.map(company), scores: tickers.map((t, i) => ({ ticker: t, score: 80 - i * 5, confidence: 'High', evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: metrics() })),
});
const aiPick = (ticker, allocationPct) => ({ ticker, allocationPct, confidence: 'High', thesis: 't', catalysts: [], risks: [] });
const aiOut = (picks, unallocatedPct) => ({ marketOutlook: 'x', picks, coverage: [], unallocatedPct });

test('AI output with one surviving company cannot reach 100%', () => {
  const r = sanitizePicks(aiOut([aiPick('A', 35), aiPick('ZZZ', 35), aiPick('A', 30)], 0), snapshot(['A', 'B']));
  assert.equal(r.picks.length, 1);
  assert.equal(r.picks[0].allocationPct, 35);
  assert.equal(r.unallocatedPct, 65);
});

test('AI output renormalising upward is re-capped and sums to 100', () => {
  const r = sanitizePicks(aiOut([aiPick('A', 30), aiPick('B', 5)], 5), snapshot(['A', 'B', 'C']));
  // 30/40 scaled to 100 would be 75%; the cap holds and the rest is cash.
  for (const p of r.picks) assert.ok(p.allocationPct <= 35);
  assert.ok(Math.abs(r.picks.reduce((a, p) => a + p.allocationPct, 0) + r.unallocatedPct - 100) <= 0.011);
  assert.equal(r.picks.find((p) => p.ticker === 'A').allocationPct, 35);
});

test('AI and quant results obey the same cap and totals', () => {
  const s = snapshot(['A', 'B', 'C', 'D', 'E', 'F']);
  const ai = sanitizePicks(aiOut([aiPick('A', 90), aiPick('B', 10)], 0), s);
  const quant = quantResult(s);
  for (const r of [ai, quant]) {
    for (const p of r.picks) assert.ok(p.allocationPct <= 35 + 1e-9);
    assert.ok(Math.abs(r.picks.reduce((a, p) => a + p.allocationPct, 0) + r.unallocatedPct - 100) <= 0.011);
  }
});

test('quantAllocation still water-fills and leaves cash when everything is capped', () => {
  const one = quantAllocation([{ ticker: 'A', score: 90, confidence: 'High', evidence: { completeness: 1, metricCount: 4, missing: [] }, metrics: metrics() }]);
  assert.deepEqual(one.picks.map((p) => p.allocationPct), [35]);
  assert.equal(one.unallocatedPct, 65);
});

test('AI output with only unusable picks falls back (null)', () => {
  assert.equal(sanitizePicks(aiOut([aiPick('ZZZ', 50)], 50), snapshot(['A'])), null);
});
