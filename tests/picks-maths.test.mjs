import test from 'node:test';
import assert from 'node:assert/strict';
import { ineligibleReason, isLossMaking, quantAllocation, quantScore } from '../lib/company-facts.ts';
import { estimateMonthlyPicks, summarizeEstimates } from '../lib/monthly-picks.ts';
import { applySizing, sizingIsStale } from '../lib/monthly-picks-allocation.ts';
import { picksBudget } from '../lib/sip-blueprint-data.ts';
import { blankPortfolio, today } from '../lib/portfolio.ts';

const m = (over) => ({
  ticker: 'T', name: 'T', peTtm: 10, earningsYieldPct: 10, epsTtm: 5, epsYoYPct: 10, epsAnnualCagrPct: 8,
  netMarginTrendPct: 1, pricePositionPct: 50, change1yPct: 10, mostRecentAnnouncement: null,
  recentAnnouncements: [], dataGaps: [], ...over,
});

test('a loss-maker ranks last on value and can never be a pick', () => {
  const list = [
    m({ ticker: 'CHEAP', earningsYieldPct: 20, epsYoYPct: 10, netMarginTrendPct: 1, change1yPct: 20 }),
    m({ ticker: 'FAIR', earningsYieldPct: 10, epsYoYPct: 15, netMarginTrendPct: 0, change1yPct: 30 }),
    m({ ticker: 'LOSS', peTtm: null, earningsYieldPct: null, epsTtm: -3, epsYoYPct: 80, netMarginTrendPct: 5, change1yPct: 90 }),
  ];
  const scores = quantScore(list);
  const by = (t) => scores.find((s) => s.ticker === t);
  assert.equal(by('LOSS').components.valuation, 0);
  assert.ok(isLossMaking(by('LOSS').metrics));
  assert.match(ineligibleReason(by('LOSS')), /Loss-making/);
  assert.equal(ineligibleReason(by('CHEAP')), null);
  const picks = quantAllocation(scores, 0).picks.map((p) => p.ticker);
  assert.ok(!picks.includes('LOSS'));
});

test('a company with fewer than three scored parts is not eligible', () => {
  const thin = m({ ticker: 'THIN', earningsYieldPct: 30, epsYoYPct: null, epsAnnualCagrPct: null, netMarginTrendPct: null, change1yPct: null });
  const [score] = quantScore([thin, m({ ticker: 'B' })]).filter((s) => s.ticker === 'THIN');
  assert.match(ineligibleReason(score), /Too little data/);
});

const quote = (price) => ({ price, date: today(), asOf: 'now', source: 'test', fetchedAt: new Date().toISOString() });
const result = (picks, cashPct = 0) => ({ marketOutlook: '', picks, coverage: [], unallocatedPct: cashPct });
const pick = (ticker, allocationPct) => ({ ticker, name: ticker, allocationPct, confidence: 'High', thesis: '', catalysts: [], risks: [], sourceUrls: [], evidenceStatus: 'ready' });

test('rounding leftover buys another share of the best-ranked pick that has room', () => {
  const p = { ...blankPortfolio(), quotes: { AAA: quote(310), BBB: quote(310), CCC: quote(310) } };
  // Rs 10,000 split 34/33/33 at Rs 310: each floors to 10 shares and leaves Rs 300, 200 and 200 unspent.
  const sized = applySizing(result([pick('AAA', 34), pick('BBB', 33), pick('CCC', 33)]), [], 10_000);
  const before = sized.picks.map((x) => Math.floor((x.allocationPct * 100) / 310));
  const out = estimateMonthlyPicks(sized, p, 10_000, 0, new Date());
  const spend = out.reduce((s, x) => s + x.estimatedSpend, 0);
  assert.ok(spend <= 10_000, 'never spends more than the fresh money');
  assert.ok(out.every((x) => x.estimatedSpend <= 3_500), 'no pick exceeds the 35% cap');
  const totalShares = out.reduce((s, x) => s + x.shares, 0);
  assert.equal(totalShares, before.reduce((s, x) => s + x, 0) + 2);
  assert.ok(out.some((x) => x.extraShares), 'at least one extra share was bought from the leftover');
  const summary = summarizeEstimates(out, 10_000);
  assert.equal(summary.estimatedSpendPkr, spend);
});

test('a pick held back by the portfolio limit never grows from leftover', () => {
  const p = { ...blankPortfolio(), quotes: { AAA: quote(300), BBB: quote(300) } };
  const holdings = [{ ticker: 'AAA', valuePkr: 19_000 }, { ticker: 'ZZZ', valuePkr: 81_000 }];
  const sized = applySizing(result([pick('AAA', 50), pick('BBB', 50)]), holdings, 10_000);
  const out = estimateMonthlyPicks(sized, p, 10_000, 0, new Date());
  const aaa = out.find((x) => x.ticker === 'AAA');
  assert.equal(aaa.extraShares, undefined);
});

test('estimates use the sizer paisa, not the rounded percent', () => {
  const p = { ...blankPortfolio(), quotes: { AAA: quote(100) } };
  const sized = applySizing(result([pick('AAA', 33.333333)]), [], 100_000);
  const [out] = estimateMonthlyPicks(sized, p, 100_000, 0, new Date());
  assert.equal(out.allocationPkr, sized.sizing.picks[0].allocationPkr);
});

test('a saved ranking is stale once the held companies or the portfolio value move a lot', () => {
  const held = [{ ticker: 'AAA', valuePkr: 100_000 }];
  const { sizing } = applySizing(result([pick('BBB', 20)]), held, 10_000);
  assert.equal(sizingIsStale(sizing, held), false);
  assert.equal(sizingIsStale(sizing, [{ ticker: 'AAA', valuePkr: 104_000 }]), false);
  assert.equal(sizingIsStale(sizing, [{ ticker: 'AAA', valuePkr: 125_000 }]), true);
  assert.equal(sizingIsStale(sizing, [...held, { ticker: 'CCC', valuePkr: 1_000 }]), true);
  assert.equal(sizingIsStale({ ...sizing, heldTickers: undefined }, [{ ticker: 'X', valuePkr: 1 }]), false);
});

test('Monthly Picks starts from what the SIP Blueprint still wants spent on stocks', () => {
  const asOf = '2026-10-15';
  const blueprint = {
    budget: 50_000, preset: 'custom', targets: { stocks: 60, funds: 40, gold: 0, currency: 0 }, strict: true, notify: false,
    since: '2026-10', months: {},
  };
  const parts = [{ id: 'p1', name: 'Main', portfolio: blankPortfolio() }];
  const budget = picksBudget(blueprint, parts, asOf);
  assert.equal(budget.planned, 30_000);
  assert.equal(budget.amount, 30_000);
  assert.equal(budget.done, false);
  const ticked = { ...blueprint, months: { '2026-10': { budget: 50_000, plan: { stocks: 30_000, funds: 20_000, gold: 0, currency: 0 }, done: { stocks: { amount: 30_000, date: asOf } } } } };
  assert.equal(picksBudget(ticked, parts, asOf).done, true);
  assert.equal(picksBudget({ ...blueprint, targets: { stocks: 0, funds: 100, gold: 0, currency: 0 } }, parts, asOf), null);
});

import { buildBenchmarks, parseBenchmarks, rankAgainst, MIN_BENCHMARK_SAMPLE } from '../lib/facts-benchmarks.ts';

const market = (n) => Array.from({ length: n }, (_, i) => m({
  ticker: `M${i}`, earningsYieldPct: 2 + i, epsYoYPct: i * 2 - 10, netMarginTrendPct: i - 5, change1yPct: i * 3 - 20, epsTtm: 5, peTtm: 10,
}));

test('a score ranks against the market, so it does not change with the rest of the shortlist', () => {
  const bench = buildBenchmarks(market(30), '2026-10-22');
  assert.equal(bench.sample, 30);
  const mid = m({ ticker: 'MID', earningsYieldPct: 16, epsYoYPct: 20, netMarginTrendPct: 10, change1yPct: 30 });
  const alone = quantScore([mid], bench)[0].score;
  const withStar = quantScore([mid, m({ ticker: 'STAR', earningsYieldPct: 99, epsYoYPct: 500, netMarginTrendPct: 80, change1yPct: 400 })], bench).find((s) => s.ticker === 'MID').score;
  assert.equal(alone, withStar);
  assert.ok(alone > 40 && alone < 70, `a middling company scores in the middle, got ${alone}`);
  // Without breakpoints a lone company is the whole market and scores 50 on every part.
  assert.equal(quantScore([mid])[0].score, 50);
});

test('a loss-maker still ranks last on value against the market', () => {
  const bench = buildBenchmarks(market(30), '2026-10-22');
  const loss = m({ ticker: 'LOSS', peTtm: null, earningsYieldPct: null, epsTtm: -2, epsYoYPct: 20, netMarginTrendPct: 10, change1yPct: 30 });
  assert.equal(quantScore([loss], bench)[0].components.valuation, 0);
});

test('breakpoints need a real market and a fresh row', () => {
  assert.equal(buildBenchmarks(market(MIN_BENCHMARK_SAMPLE - 1), '2026-10-22'), null);
  const bench = buildBenchmarks(market(MIN_BENCHMARK_SAMPLE), '2026-10-22');
  assert.ok(parseBenchmarks(JSON.parse(JSON.stringify(bench)), '2026-11-01'));
  assert.equal(parseBenchmarks(JSON.parse(JSON.stringify(bench)), '2026-12-15'), null, 'older than 30 days');
  assert.equal(parseBenchmarks({ computedOn: '2026-10-22', sample: 20, points: { valuation: [1, 2] } }, '2026-10-22'), null);
  assert.equal(rankAgainst([0, 10, 20], -5), 0);
  assert.equal(rankAgainst([0, 10, 20], 99), 100);
  assert.equal(rankAgainst([0, 10, 20], 5), 25);
});
