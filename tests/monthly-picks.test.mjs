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
