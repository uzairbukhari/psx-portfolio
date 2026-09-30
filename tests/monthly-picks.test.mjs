import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMonthlyPicks, validateMonthlyPicksResearch } from '../lib/monthly-picks.ts';
import { today } from '../lib/portfolio.ts';

const sourceA = 'https://www.psx.com.pk/alpha-results';
const sourceB = 'https://www.psx.com.pk/beta-results';
const research = {
  marketOutlook: 'Selective opportunities with material short-term risk.',
  picks: [{
    ticker: 'AAA', name: 'Alpha', allocationPct: 60, confidence: 'Medium', thesis: 'Supported setup.',
    whySelected: 'Stronger evidence than assessed alternatives.', invalidation: 'Margins reverse.',
    catalysts: ['Published result'], risks: ['Market volatility'], sourceUrls: [sourceA],
  }],
  coverage: [
    { ticker: 'AAA', outlook: 'Positive', summary: 'Supported.', sourceUrls: [sourceA], assessmentStatus: 'assessed' },
    { ticker: 'BBB', outlook: 'Neutral', summary: 'Mixed.', sourceUrls: [sourceB], assessmentStatus: 'assessed' },
  ],
  unallocatedPct: 40,
};
const portfolio = {
  companies: [
    { ticker: 'AAA', name: 'Alpha', sector: 'Bank', target: 0, approved: false, screenDate: '', note: '' },
    { ticker: 'BBB', name: 'Beta', sector: 'Cement', target: 0, approved: false, screenDate: '', note: '' },
  ],
  trades: [], budgets: {},
  quotes: { AAA: { price: 101, date: today(), asOf: today(), source: sourceA, fetchedAt: new Date().toISOString() } },
};

test('validates complete company-specific coverage', () => {
  const result = validateMonthlyPicksResearch(research, ['AAA', 'BBB'], new Set([sourceA, sourceB]));
  assert.equal(result.assessedCount, 2);
  assert.equal(result.totalCount, 2);
  assert.ok(result.coverage.every(company => company.evidenceStatus === 'ready'));
  assert.throws(() => validateMonthlyPicksResearch({ ...research, coverage: research.coverage.slice(0, 1) }, ['AAA', 'BBB'], new Set([sourceA, sourceB])));
});

test('never substitutes coverage when a pick source is unregistered', () => {
  const invalid = structuredClone(research);
  invalid.picks[0].sourceUrls = ['https://invented.invalid/alpha'];
  assert.throws(() => validateMonthlyPicksResearch(invalid, ['AAA', 'BBB'], new Set([sourceA, sourceB])), /without company-specific supporting sources/);
});

test('unassessed candidates remain separate from outlook and cannot be selected', () => {
  const partial = structuredClone(research);
  partial.coverage[1] = { ticker: 'BBB', outlook: 'Insufficient evidence', summary: 'Not assessed.', sourceUrls: [], assessmentStatus: 'unassessed', evidenceGap: 'Latest filing unavailable.' };
  const result = validateMonthlyPicksResearch(partial, ['AAA', 'BBB'], new Set([sourceA]));
  assert.equal(result.coverage[1].assessmentStatus, 'unassessed');
  assert.equal(result.coverage[1].outlook, 'Insufficient evidence');
  assert.deepEqual(result.evidenceIssues, [{ ticker: 'BBB', kind: 'material_gap', message: 'Latest filing unavailable.' }]);
  const invalid = structuredClone(partial);
  invalid.picks = [{ ...invalid.picks[0], ticker: 'BBB', name: 'Beta' }];
  assert.throws(() => validateMonthlyPicksResearch(invalid, ['AAA', 'BBB'], new Set([sourceA])), /unassessed company BBB/);
});

test('partial recommendations calculate supported picks with fresh prices', () => {
  const partial = validateMonthlyPicksResearch({
    ...research,
    coverage: [research.coverage[0], { ticker: 'BBB', outlook: 'Insufficient evidence', summary: 'Not assessed.', sourceUrls: [], assessmentStatus: 'unassessed', evidenceGap: 'Missing evidence.' }],
  }, ['AAA', 'BBB'], new Set([sourceA]));
  const [pick] = estimateMonthlyPicks(partial, portfolio, 100000, 1);
  assert.equal(pick.shares, 588);
  assert.ok(pick.estimatedSpend <= pick.allocationPkr);
});

test('missing or stale prices withhold only the share estimate', () => {
  const old = structuredClone(portfolio);
  old.quotes.AAA.date = '2020-01-01';
  assert.equal(estimateMonthlyPicks(research, old, 100000, 0)[0].shares, null);
  const missing = structuredClone(portfolio);
  delete missing.quotes.AAA;
  assert.equal(estimateMonthlyPicks(research, missing, 100000, 0)[0].shares, null);
});

import { summarizeEstimates } from '../lib/monthly-picks.ts';
import { inputDifferences } from '../lib/monthly-picks-flow.ts';

const twoPicks = {
  ...research,
  picks: [
    { ...research.picks[0], allocationPct: 30 },
    { ...research.picks[0], ticker: 'BBB', name: 'Beta', allocationPct: 30 },
  ],
  unallocatedPct: 40,
};
const pricedBoth = { ...portfolio, quotes: { ...portfolio.quotes, BBB: { price: 55, date: today(), asOf: today(), source: sourceB, fetchedAt: new Date().toISOString() } } };

test('summary separates planned cash from whole-share leftovers and reconciles to fee-inclusive spend', () => {
  const estimates = estimateMonthlyPicks(twoPicks, pricedBoth, 100000, 0.5);
  const s = summarizeEstimates(estimates, 100000);
  assert.equal(s.incomplete, false);
  assert.deepEqual(s.missingPrices, []);
  assert.equal(s.plannedCashPkr, 40000);
  assert.equal(s.allocatedPkr, 60000);
  const spend = estimates.reduce((a, e) => a + e.estimatedSpend, 0);
  assert.equal(s.estimatedSpendPkr, Math.round(spend * 100) / 100);
  assert.equal(s.roundingLeftoverPkr, Math.round((60000 - spend) * 100) / 100);
  assert.equal(s.unspentPkr, Math.round((100000 - spend) * 100) / 100);
  assert.equal(Math.round((s.plannedCashPkr + s.roundingLeftoverPkr) * 100) / 100, s.unspentPkr);
});

test('a missing price makes the estimate incomplete instead of treating that pick as cash-neutral', () => {
  const estimates = estimateMonthlyPicks(twoPicks, portfolio, 100000, 0);
  const s = summarizeEstimates(estimates, 100000);
  assert.equal(s.incomplete, true);
  assert.deepEqual(s.missingPrices, ['BBB']);
  assert.equal(s.unspentPkr, null);
  assert.equal(s.roundingLeftoverPkr, null);
  assert.equal(s.plannedCashPkr, 40000, 'the planned reserve is known even when prices are missing');
  assert.ok(s.estimatedSpendPkr > 0, 'spend so far counts priced picks');
});

test('no picks means everything is planned cash and nothing is incomplete', () => {
  const s = summarizeEstimates([], 50000);
  assert.deepEqual([s.plannedCashPkr, s.allocatedPkr, s.unspentPkr, s.incomplete], [50000, 0, 50000, false]);
});

test('inputDifferences lists each draft input that differs from the saved run', () => {
  const run = { month: '2026-09', amount: 100000, feePct: 0.5, shortlist: ['AAA', 'BBB'] };
  assert.deepEqual(inputDifferences(run, { month: '2026-09', amount: 100000, feePct: 0.5, shortlist: ['BBB', 'AAA'] }), []);
  assert.deepEqual(inputDifferences(run, { month: '2026-10', amount: 120000, feePct: 0.25, shortlist: ['AAA'] }), ['month', 'amount', 'fees', 'shortlist']);
  assert.deepEqual(inputDifferences(run, { month: '2026-09', amount: 100000, feePct: 0.5, shortlist: ['AAA', 'BBB', 'CCC'] }), ['shortlist']);
});
