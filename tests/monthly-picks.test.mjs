import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateMonthlyPicks,
  validateMonthlyPicksResearch,
} from '../lib/monthly-picks.ts';
import { today } from '../lib/portfolio.ts';

const source = 'https://www.psx.com.pk/example';
const research = {
  marketOutlook: 'Selective opportunities with material short-term risk.',
  picks: [
    {
      ticker: 'AAA',
      name: 'Alpha',
      allocationPct: 60,
      confidence: 'Medium',
      thesis: 'Recent evidence supports a stronger near-term setup.',
      catalysts: ['Result announcement'],
      risks: ['Market volatility'],
      sourceUrls: [source],
    },
  ],
  coverage: [
    { ticker: 'AAA', outlook: 'Positive', summary: 'Supported.', sourceUrls: [source] },
    { ticker: 'BBB', outlook: 'Neutral', summary: 'Mixed.', sourceUrls: [source] },
  ],
  unallocatedPct: 40,
};

const portfolio = {
  companies: [
    { ticker: 'AAA', name: 'Alpha', sector: 'Bank', target: 0, approved: false, screenDate: '', note: '' },
    { ticker: 'BBB', name: 'Beta', sector: 'Cement', target: 0, approved: false, screenDate: '', note: '' },
  ],
  trades: [],
  budgets: {},
  quotes: {
    AAA: { price: 101, date: today(), asOf: today(), source: 'https://dps.psx.com.pk/company/AAA', fetchedAt: new Date().toISOString() },
  },
};

test('validates complete shortlist coverage and discovered source URLs', () => {
  assert.deepEqual(
    validateMonthlyPicksResearch(research, ['AAA', 'BBB'], new Set([source])),
    research,
  );
  assert.throws(() =>
    validateMonthlyPicksResearch(
      { ...research, coverage: research.coverage.slice(0, 1) },
      ['AAA', 'BBB'],
      new Set([source]),
    ),
  );
});

test('normalizes shortlist tickers and harmless source URL variations', () => {
  const varied = structuredClone(research);
  varied.picks[0].ticker = ' aaa ';
  varied.picks[0].sourceUrls = ['https://www.psx.com.pk/example/?utm_source=openai#results'];
  varied.coverage[0].ticker = 'aaa';
  varied.coverage[0].sourceUrls = ['https://www.psx.com.pk/example#company'];
  const validated = validateMonthlyPicksResearch(varied, ['AAA', 'BBB'], new Set([source]));
  assert.equal(validated.picks[0].ticker, 'AAA');
  assert.deepEqual(validated.picks[0].sourceUrls, [source]);
  assert.equal(validated.coverage[0].ticker, 'AAA');
});

test('uses verified company coverage when a pick repeats an unrelated URL', () => {
  const invalid = structuredClone(research);
  invalid.picks[0].sourceUrls = ['https://www.psx.com.pk/different'];
  const validated = validateMonthlyPicksResearch(invalid, ['AAA', 'BBB'], new Set([source]));
  assert.deepEqual(validated.picks[0].sourceUrls, [source]);
});

test('withholds an unsupported pick and leaves its allocation uninvested', () => {
  const unsupported = structuredClone(research);
  unsupported.picks[0].sourceUrls = ['https://invented.invalid/company'];
  unsupported.coverage[0].sourceUrls = ['https://invented.invalid/company'];
  const validated = validateMonthlyPicksResearch(
    unsupported,
    ['AAA', 'BBB'],
    new Set([source]),
  );
  assert.deepEqual(validated.picks, []);
  assert.equal(validated.unallocatedPct, 100);
  assert.equal(validated.coverage[0].outlook, 'Insufficient evidence');
  assert.deepEqual(validated.coverage[0].sourceUrls, []);
});

test('whole-share estimates include fees and stay within each allocation', () => {
  const [pick] = estimateMonthlyPicks(research, portfolio, 100000, 1);
  assert.equal(pick.allocationPkr, 60000);
  assert.equal(pick.shares, 588);
  assert.ok(pick.estimatedSpend <= pick.allocationPkr);
  assert.equal(
    Math.round((pick.estimatedSpend + pick.cashRemaining) * 100),
    pick.allocationPkr * 100,
  );
});

test('missing or older prices retain allocation but withhold quantities', () => {
  const old = structuredClone(portfolio);
  old.quotes.AAA.date = '2020-01-01';
  let [pick] = estimateMonthlyPicks(research, old, 100000, 0);
  assert.equal(pick.allocationPkr, 60000);
  assert.equal(pick.shares, null);
  const missing = structuredClone(portfolio);
  delete missing.quotes.AAA;
  [pick] = estimateMonthlyPicks(research, missing, 100000, 0);
  assert.equal(pick.shares, null);
});
