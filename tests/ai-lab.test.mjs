import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAiLabResult, estimateAiLabBuys, ineligibleReason, recordAiLabRun } from '../lib/ai-lab-picks.ts';
import { reviewHoldings } from '../lib/holdings-review.ts';
import { chooseRanking, workflowFor } from '../lib/ai-lab-server.ts';
import { validate, blankPortfolio } from '../lib/portfolio.ts';
import { latestCompletedSessionDate } from '../lib/psx-calendar.ts';

const NOW = new Date('2026-10-20T10:00:00Z');
const root = fileURLToPath(new URL('../', import.meta.url));

function report(ticker, overrides = {}, view = {}) {
  return {
    ticker, inputsHash: 'h', priceAtReport: 100, researchedAt: '2026-10-15T00:00:00Z', checkedAt: '2026-10-15T00:00:00Z', carriedForward: false, model: 'gpt-5-mini',
    verification: { claims: 4, verified: 4, dropped: 0, convictionPenalty: 0 },
    report: {
      thesis: `${ticker} thesis`, businessSummary: '', earningsQuality: '', valuationView: `${ticker} valuation`, dividendOutlook: '', catalysts: [{ date: '2026-11-01', text: 'Results', sourceUrl: '' }],
      risks: ['r'], bullCase: 'up', bearCase: 'down', expectedReturn: { lowPct: -3, basePct: 9, highPct: 20, horizonDays: 90 }, conviction: 72,
      evidence: [{ claim: 'P/E 7', factKey: 'peTtm', sourceUrl: '', quote: '', verified: true }], dataGaps: [],
      holdingView: { thesisState: 'intact', redFlags: [], stretchedValuation: false, whatWouldMakeItASell: 'A dividend cut.', ...view }, ...overrides,
    },
  };
}
const research = (reports, ranking = null) => ({ reports, ranking, macro: { summary: 'Rates falling.' }, requests: [], spend: { month: '2026-10', usd: 0.4, capUsd: 5 }, enabled: true });
const ranking = (entries) => ({ month: '2026-10', tickersHash: 'x', outlook: 'Constructive.', entries, excluded: [] });
const entry = (ticker, rank, weight, conviction = 70) => ({ ticker, rank, conviction, modelWeightPct: weight, note: `${ticker} note` });

test('picks: only researched, verified, convincing companies get money, in ranked order', () => {
  const reports = [report('AAA'), report('BBB', { conviction: 30 }), report('CCC', {}, { thesisState: 'broken' }), report('DDD', { expectedReturn: { lowPct: -9, basePct: -1, highPct: 4, horizonDays: 90 } })];
  const result = buildAiLabResult({
    shortlist: ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'], research: research(reports, ranking([entry('AAA', 1, 30)])),
    names: { AAA: 'Alpha' }, holdings: [], amount: 100_000, now: NOW,
  });
  assert.deepEqual(result.picks.map((p) => p.ticker), ['AAA']);
  assert.equal(result.picks[0].name, 'Alpha');
  assert.deepEqual(result.excluded.map((e) => e.ticker).sort(), ['BBB', 'CCC', 'DDD', 'EEE']);
  assert.match(result.excluded.find((e) => e.ticker === 'EEE').reason, /No AI research/);
  // The model suggests 30%, but with an empty portfolio the 20% concentration limit caps one pick at 20% of the money.
  assert.equal(result.picks[0].allocationPct, 20);
  assert.equal(result.unallocatedPct, 80);
  assert.equal(result.sizing.cashPkr, 80_000);
  assert.equal(result.sizing.picks[0].constrainedBy, 'concentration_cap');
});

test('picks: the 35% and 20% limits still apply on the device, and an overweight holding gets nothing new', () => {
  const reports = [report('AAA'), report('BBB')];
  const result = buildAiLabResult({
    shortlist: ['AAA', 'BBB'], research: research(reports, ranking([entry('AAA', 1, 50), entry('BBB', 2, 50)])),
    names: {}, holdings: [{ ticker: 'BBB', valuePkr: 900_000 }], amount: 100_000, now: NOW,
  });
  assert.equal(result.picks.length, 1, 'BBB is overweight so it is dropped');
  assert.equal(result.picks[0].ticker, 'AAA');
  assert.ok(result.picks[0].allocationPct <= 35);
  assert.ok(result.sizing.picks.some((p) => p.ticker === 'BBB' && p.constrainedBy === 'overweight'));
});

test('picks: without a ranking, weights follow conviction and at most five companies are chosen', () => {
  const tickers = ['A1', 'B2', 'C3', 'D4', 'E5', 'F6'];
  const reports = tickers.map((t, i) => report(t, { conviction: 80 - i }));
  const result = buildAiLabResult({ shortlist: tickers, research: research(reports), names: {}, holdings: [], amount: 50_000, now: NOW });
  assert.equal(result.picks.length, 5);
  assert.equal(result.picks[0].ticker, 'A1');
  assert.ok(result.excluded.some((e) => e.ticker === 'F6' && /top 5/.test(e.reason)));
});

test('picks: stale or poorly verified research is not used', () => {
  assert.match(ineligibleReason(report('AAA', {}, {}) && { ...report('AAA'), checkedAt: '2026-07-01T00:00:00Z' }, NOW), /out of date/);
  assert.match(ineligibleReason({ ...report('AAA'), verification: { claims: 10, verified: 3, dropped: 7, convictionPenalty: 30 } }, NOW), /sources did not check out/);
  assert.equal(ineligibleReason(report('AAA'), NOW), null);
});

test('picks: share estimates come from fresh PSX quotes through the Monthly Picks estimator', () => {
  const result = buildAiLabResult({ shortlist: ['AAA'], research: research([report('AAA')], ranking([entry('AAA', 1, 30)])), names: {}, holdings: [], amount: 100_000, now: NOW });
  // The estimator checks the quote date against the real calendar, so use the real current session here.
  const real = new Date();
  const portfolio = { ...blankPortfolio(), quotes: { AAA: { price: 100, date: latestCompletedSessionDate(real), source: 'psx' } } };
  const [estimate] = estimateAiLabBuys(result, portfolio, 100_000, 0.5, real);
  assert.equal(estimate.allocationPkr, 20_000);
  assert.ok(estimate.shares > 150 && estimate.shares <= 200);
  const [noQuote] = estimateAiLabBuys(result, blankPortfolio(), 100_000, 0.5, real);
  assert.equal(noQuote.shares, null);
});

test('chooseRanking picks the ranking that covers most of the tickers', () => {
  const a = { ranking: ranking([entry('AAA', 1, 30)]), createdAt: '2026-10-02' };
  const b = { ranking: ranking([entry('AAA', 1, 30), entry('BBB', 2, 30)]), createdAt: '2026-10-01' };
  assert.equal(chooseRanking([a, b], ['AAA', 'BBB']), b.ranking);
  assert.equal(chooseRanking([a, b], ['ZZZ']), null);
  assert.equal(workflowFor('staging'), 'ai-research-staging.yml');
  assert.equal(workflowFor('production'), 'ai-research.yml');
});

const pos = (ticker, value, cost = value * 0.8, shares = 100) => ({ ticker, name: ticker, shares, value, price: value / shares, cost });

test('holdings review: sell only with a verified red flag, trim over the limit, add with room, keep otherwise', () => {
  const flag = { text: 'Qualified audit opinion', sourceUrl: 'https://www.brecorder.com/a', quote: 'qualified opinion', verified: true };
  const reports = [
    report('SELL', { conviction: 20 }, { thesisState: 'broken', redFlags: [flag] }),
    report('WEAK', { conviction: 20 }, { thesisState: 'weakened' }),
    report('BIG', { conviction: 65 }),
    report('GOOD', { conviction: 78 }),
    report('FINE', { conviction: 60 }),
    report('PRICEY', { conviction: 45 }, { stretchedValuation: true }),
  ];
  const positions = [pos('SELL', 100), pos('WEAK', 100), pos('BIG', 400), pos('GOOD', 100), pos('FINE', 100), pos('PRICEY', 100), pos('NEW', 100)];
  const out = Object.fromEntries(reviewHoldings(positions, research(reports), NOW).map((s) => [s.ticker, s]));
  assert.equal(out.SELL.action, 'sell');
  assert.equal(out.WEAK.action, 'keep', 'a low score alone, without a verified red flag, never says sell');
  assert.equal(out.BIG.action, 'trim');
  assert.ok(out.BIG.trimShares > 0 && out.BIG.trimShares <= 100);
  assert.equal(out.GOOD.action, 'add');
  assert.equal(out.FINE.action, 'keep');
  assert.equal(out.PRICEY.action, 'trim');
  assert.equal(out.NEW.action, 'review');
  assert.equal(Object.keys(out)[0], 'SELL', 'sell suggestions are listed first');
});

test('holdings review: trim shares bring the position back to the limit and never exceed what is held', () => {
  const out = reviewHoldings([pos('BIG', 500, 400, 10), pos('OTHER', 500, 400, 10)], research([report('BIG'), report('OTHER')]), NOW);
  const big = out.find((s) => s.ticker === 'BIG');
  // Total 1000, limit 20% = 200, excess 300 at 50 per share = 6 shares.
  assert.equal(big.action, 'trim');
  assert.equal(big.trimShares, 6);
  assert.equal(out.find((s) => s.ticker === 'OTHER').action, 'trim');
});

test('holdings review: a position with no price is reviewed, closed positions are ignored, stale research gives no call', () => {
  const out = reviewHoldings([{ ticker: 'AAA', name: 'A', shares: 10, value: null, price: null, cost: null }, pos('CLOSED', 0, 0, 0)],
    research([{ ...report('AAA'), checkedAt: '2026-06-01T00:00:00Z' }]), NOW);
  assert.equal(out.length, 1);
  assert.equal(out[0].action, 'review');
});

test('AI Lab runs are validated and bounded in the portfolio', () => {
  const run = { id: 'r1', month: '2026-10', amount: 1000, feePct: 0.5, shortlist: ['AAA'], createdAt: NOW.toISOString(), result: { picks: [], excluded: [] } };
  assert.doesNotThrow(() => validate({ ...blankPortfolio(), aiLabRuns: [run] }));
  assert.throws(() => validate({ ...blankPortfolio(), aiLabRuns: [{ ...run, month: 'nope' }] }), /AI Lab/);
  assert.throws(() => validate({ ...blankPortfolio(), aiLabRuns: Array.from({ length: 13 }, (_, i) => ({ ...run, id: `r${i}` })) }), /AI Lab/);
  assert.equal(recordAiLabRun([{ id: 'a' }, { id: 'b' }], { id: 'b' }).map((r) => r.id).join(), 'b,a');
});

test('privacy: research code and the AI Lab route never touch portfolios, holdings or the vault', () => {
  const files = [
    ...readdirSync(root + 'lib/ai-research').map((f) => `lib/ai-research/${f}`),
    'lib/ai-lab-server.ts', 'scripts/ai-research.mjs', 'app/api/ai-lab/research/route.ts',
  ];
  for (const file of files) {
    const text = readFileSync(root + file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/vaultDb|VAULT_DB|vault_portfolios|\bportfolios\b|monthlyPicks|aiLabRuns|holdings\(/i.test(text), `${file} must not reference private data`);
  }
});

test('OpenAI output ceiling leaves room for reasoning tokens; Anthropic does not', async () => {
  const { resolveConfig, outputCeiling } = await import('../lib/ai-research/models.ts');
  const openai = resolveConfig({});
  assert.ok(outputCeiling(openai, 'read', 2500) >= 2500 + 2000);
  assert.ok(outputCeiling(openai, 'rank', 6000) > outputCeiling(openai, 'read', 6000));
  assert.equal(outputCeiling(resolveConfig({ AI_RESEARCH_PROVIDER: 'anthropic' }), 'read', 2500), 2500);
});

test('picks: when too few companies clear the bar, the best lower-conviction ones fill in, sized down and labelled', () => {
  const lowVerification = { claims: 4, verified: 4, dropped: 0, convictionPenalty: 0 };
  const mk = (t, conviction, basePct) => report(t, { conviction, expectedReturn: { lowPct: -5, basePct, highPct: 12, horizonDays: 90 } }, {});
  const reports = [mk('S1', 60, 6), mk('L1', 42, 5), mk('L2', 40, 4), mk('L3', 38, 3), mk('BAD', 20, 5), mk('NEG', 45, -1)].map((r) => ({ ...r, verification: lowVerification }));
  const result = buildAiLabResult({ shortlist: reports.map((r) => r.ticker), research: research(reports), names: {}, holdings: [], amount: 50_000, now: NOW });
  assert.deepEqual(result.picks.map((p) => p.ticker), ['S1', 'L1', 'L2', 'L3']);
  assert.deepEqual(result.picks.map((p) => !!p.lowConviction), [false, true, true, true]);
  assert.ok(result.excluded.some((e) => e.ticker === 'BAD') && result.excluded.some((e) => e.ticker === 'NEG'));
  // With three strong ones, lower-conviction names stay out.
  const strong = ['A', 'B', 'C'].map((t) => ({ ...mk(t, 70, 5), verification: lowVerification })).concat(reports.slice(1, 3));
  const second = buildAiLabResult({ shortlist: strong.map((r) => r.ticker), research: research(strong), names: {}, holdings: [], amount: 50_000, now: NOW });
  assert.deepEqual(second.picks.map((p) => p.ticker).sort(), ['A', 'B', 'C']);
});
