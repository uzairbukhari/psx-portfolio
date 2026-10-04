import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { restLike } from './helpers/d1-rest-like.mjs';
import { Ledger, CapReachedError, monthKey } from '../lib/ai-research/ledger.ts';
import { costOf, resolveConfig, worstCaseCost } from '../lib/ai-research/models.ts';
import { decideReuse, reportUsable } from '../lib/ai-research/reuse.ts';
import { buildFactPack, maxDrawdownPct, returnOver, trailingYieldPct, volatilityPct } from '../lib/ai-research/factpack.ts';
import { verifyReport } from '../lib/ai-research/verify.ts';
import { cleanRanking, runResearch } from '../lib/ai-research/pipeline.ts';
import { createStore } from '../lib/ai-research/store.ts';
import { htmlToText, pdfToText, publicHttpsUrl } from '../lib/ai-research/fetch-text.ts';
import { buildLedgerPdf, entries } from './helpers/ahl-ledger-fixture.mjs';

const NOW = new Date('2026-10-20T10:00:00Z');
const DAY = 86400;

function facts(ticker, overrides = {}) {
  return {
    ticker, name: `${ticker} Ltd`, sector: 'Cement', price: 100, priceDate: '2026-10-19', peTtm: 8, week52: { low: 60, high: 120 },
    change1y: 25, changeYtd: 10, marketCapThousands: 5_000_000, freeFloatPct: 30,
    annual: [{ period: '2025', revenue: 1000, pat: 200, eps: 12 }, { period: '2024', revenue: 900, pat: 150, eps: 9 }],
    quarterly: [{ period: 'Q1 2026', revenue: 300, pat: 60, eps: 3.5 }, { period: 'Q4 2025', revenue: 280, pat: 50, eps: 3 }],
    ratios: { grossMargin: [], netMargin: [20, 17], epsGrowth: [], peg: [] },
    announcements: [{ date: '2026-10-01', title: 'Financial Results for the year ended June 30, 2026', category: 'Financial Results', url: 'https://dps.psx.com.pk/download/doc/1.pdf' }],
    source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt: '2026-10-19T12:00:00Z', ...overrides,
  };
}
function closes(days = 400, start = 80, step = 0.1) {
  const base = Math.floor(NOW.getTime() / 1000) - days * DAY;
  return Array.from({ length: days }, (_, i) => [base + i * DAY, start + i * step + (i % 7 === 0 ? 1 : 0)]);
}
function seed(db, ticker, factsValue = facts(ticker)) {
  db.sqlite.prepare('INSERT OR REPLACE INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES (?,?,?,?)').run(ticker, '2026-10-19', JSON.stringify(factsValue), factsValue.fetchedAt);
  db.sqlite.prepare('INSERT OR REPLACE INTO price_history (ticker,eod) VALUES (?,?)').run(ticker, JSON.stringify(closes()));
}

const reportBody = (overrides = {}) => ({
  thesis: 'Cheap and growing.', businessSummary: 'Cement.', earningsQuality: 'Clean.', valuationView: 'Below sector.', dividendOutlook: 'Stable.',
  catalysts: [{ date: '2026-11-01', text: 'Results', sourceUrl: '' }], risks: ['Demand'], bullCase: 'Up', bearCase: 'Down',
  expectedReturn: { lowPct: -5, basePct: 8, highPct: 18, horizonDays: 90 }, conviction: 70,
  evidence: [
    { claim: 'P/E is 8', factKey: 'peTtm', sourceUrl: '', quote: '' },
    { claim: 'Made up number', factKey: 'notAKey', sourceUrl: '', quote: '' },
  ],
  dataGaps: [],
  holdingView: { thesisState: 'intact', redFlags: [], stretchedValuation: false, whatWouldMakeItASell: 'Dividend cut.' },
  newNews: [], ...overrides,
});

function fakeProvider(log = [], handlers = {}) {
  return {
    id: 'openai',
    async call(request) {
      log.push(request.stage);
      const stage = request.stage.split(':')[0];
      const usage = { inputTokens: 2000, outputTokens: 800, cachedTokens: 0, searches: request.webSearch ? 1 : 0 };
      const model = 'gpt-5-mini';
      if (handlers[stage]) return { json: handlers[stage](request), usage, model, sources: [] };
      const json = {
        macro: { summary: 's', policyRate: 'r', inflation: 'i', currency: 'c', fiscalAndImf: 'f', sectorViews: [], sources: [] },
        profile: { business: 'b', segments: [], sensitivities: [], ownershipAndManagement: 'o', dividendPolicy: 'd' },
        filing: { period: 'FY2026', revenue: 1, profitAfterTax: 1, eps: 1, margins: '', financeCost: null, otherIncome: null, oneOffs: [], debt: '', dividendDeclared: '', auditorOpinion: '', commentary: '' },
        company: reportBody(), bear: { strongestCase: 'It could fall.', issues: [], convictionAdjustment: -5 },
        rank: { outlook: 'Fine.', entries: [] },
      }[stage];
      if (stage === 'rank') {
        const tickers = [...request.input.matchAll(/"ticker":"([A-Z0-9]+)"/g)].map((m) => m[1]);
        json.entries = tickers.map((ticker, i) => ({ ticker, rank: i + 1, conviction: 60, modelWeightPct: 30, note: 'n' }));
      }
      return { json, usage, model, sources: [] };
    },
  };
}
const io = (extra = {}) => ({ fetchText: async () => 'x'.repeat(400), now: () => NOW, log: () => {}, ...extra });
const config = (cap = 5) => ({ ...resolveConfig({}), monthlyCapUsd: cap });

test('config defaults to OpenAI with a $5 cap and switches to Claude by setting', () => {
  const base = resolveConfig({});
  assert.deepEqual([base.provider, base.models.read, base.models.rank, base.monthlyCapUsd, base.enabled], ['openai', 'gpt-5-mini', 'gpt-5', null, true]);
  const claude = resolveConfig({ AI_RESEARCH_PROVIDER: 'Anthropic', AI_RESEARCH_MONTHLY_CAP_USD: '1', AI_LAB_ENABLED: 'false' });
  assert.deepEqual([claude.provider, claude.models.read, claude.models.rank, claude.monthlyCapUsd, claude.enabled], ['anthropic', 'claude-sonnet-5-5', 'claude-opus-5-5', 1, false]);
  assert.equal(resolveConfig({ AI_RESEARCH_PROVIDER: 'nonsense', AI_RESEARCH_MONTHLY_CAP_USD: '-3' }).monthlyCapUsd, null);
});

test('costs: cached tokens are cheaper, searches are billed, unknown models are priced pessimistically', () => {
  const plain = costOf('gpt-5-mini', { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, searches: 0 });
  const cached = costOf('gpt-5-mini', { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000, searches: 0 });
  assert.equal(plain, 0.25);
  assert.equal(cached, 0.025);
  assert.equal(costOf('gpt-5-mini', { inputTokens: 0, outputTokens: 0, cachedTokens: 0, searches: 3 }), 0.03);
  assert.ok(costOf('mystery-model', { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0, searches: 0 }) > 2);
  assert.ok(worstCaseCost('gpt-5', 1000, 1000, 2) > costOf('gpt-5', { inputTokens: 1000, outputTokens: 500, cachedTokens: 0, searches: 1 }));
});

test('a ledger without a cap never blocks but still records spend', () => {
  const ledger = new Ledger(null, 100);
  const settle = ledger.reserve(1000);
  settle(3);
  assert.equal(ledger.spentUsd, 103);
  assert.equal(ledger.remainingUsd, Infinity);
});

test('ledger blocks a call that would cross the cap and honours the ranking hold', () => {
  const ledger = new Ledger(1, 0.9);
  assert.throws(() => ledger.reserve(0.2), CapReachedError);
  const settle = ledger.reserve(0.05);
  settle(0.02);
  assert.ok(Math.abs(ledger.spentUsd - 0.92) < 1e-9);
  ledger.setHold(0.07);
  assert.equal(ledger.canAfford(0.03), false);
  assert.equal(ledger.canAfford(0.03, true), true);
  // A failed call with unknown cost counts its worst case.
  const l2 = new Ledger(1, 0);
  l2.reserve(0.4)(null);
  assert.equal(l2.spentUsd, 0.4);
  assert.equal(monthKey(NOW), '2026-10');
});

test('reuse rule: full, update, carry, fresh', () => {
  const stored = { inputsHash: 'a', priceAtReport: 100, checkedAt: '2026-10-10T00:00:00Z' };
  assert.equal(decideReuse({ stored: null, inputsHash: 'a', price: 100, now: NOW }), 'full');
  assert.equal(decideReuse({ stored, inputsHash: 'b', price: 100, now: NOW }), 'update');
  assert.equal(decideReuse({ stored, inputsHash: 'a', price: 111, now: NOW }), 'update');
  assert.equal(decideReuse({ stored, inputsHash: 'a', price: 109, now: NOW }), 'fresh');
  assert.equal(decideReuse({ stored: { ...stored, checkedAt: '2026-08-01T00:00:00Z' }, inputsHash: 'a', price: 100, now: NOW }), 'carry');
  assert.equal(decideReuse({ stored, inputsHash: 'a', price: 100, now: NOW, force: true }), 'update');
});

test('reportUsable needs a recent check and mostly verified claims', () => {
  const ok = { checkedAt: '2026-10-10T00:00:00Z', verification: { claims: 4, verified: 3, dropped: 1, convictionPenalty: 5 } };
  assert.equal(reportUsable(ok, NOW), true);
  assert.equal(reportUsable({ ...ok, verification: { claims: 4, verified: 1, dropped: 3, convictionPenalty: 15 } }, NOW), false);
  assert.equal(reportUsable({ ...ok, checkedAt: '2026-08-01T00:00:00Z' }, NOW), false);
});

test('fact pack statistics from price history and dividends', () => {
  const c = closes();
  assert.ok(returnOver(c, 91) > 0);
  assert.equal(returnOver(c.slice(-10), 365), null);
  assert.ok(volatilityPct(c) > 0);
  assert.ok(maxDrawdownPct(c) <= 0);
  assert.equal(trailingYieldPct([{ announcedOn: '2026-06-01', perShareRs: 5, percent: 50, bookClosureStart: '', kind: 'cash' }], 100, '2026-10-20'), 5);
  assert.equal(trailingYieldPct([], 100, '2026-10-20'), 0);
  const pack = buildFactPack({ facts: facts('AAA'), closes: c, dividends: [], sectorMedianPe: 9, asOf: '2026-10-20' });
  assert.equal(pack.facts.peTtm.value, 8);
  assert.equal(pack.facts.sectorMedianPe.value, 9);
  assert.equal(pack.latestFilingUrl, 'https://dps.psx.com.pk/download/doc/1.pdf');
});

test('verifier drops unsupported evidence, penalises conviction and blocks unverified sells', () => {
  const pack = buildFactPack({ facts: facts('AAA'), closes: closes(), dividends: [], sectorMedianPe: null, asOf: '2026-10-20' });
  const seen = new Map([['https://www.brecorder.com/a', 'The company said its auditor issued a qualified opinion on the accounts.']]);
  const body = reportBody({
    conviction: 40,
    evidence: [
      { claim: 'P/E', factKey: 'peTtm', sourceUrl: '', quote: '' },
      { claim: 'bad key', factKey: 'zzz', sourceUrl: '', quote: '' },
      { claim: 'quote ok', factKey: '', sourceUrl: 'https://www.brecorder.com/a', quote: 'auditor issued a qualified opinion' },
      { claim: 'quote fake', factKey: '', sourceUrl: 'https://www.brecorder.com/a', quote: 'the ceo resigned yesterday' },
    ],
    holdingView: { thesisState: 'broken', whatWouldMakeItASell: 'x', stretchedValuation: false,
      redFlags: [{ text: 'Invented', sourceUrl: 'https://example.com/none', quote: 'invented quote text here' }] },
  });
  delete body.newNews;
  const { report, stats } = verifyReport(body, pack, seen);
  assert.equal(report.evidence.length, 2);
  assert.equal(stats.dropped, 3);
  assert.equal(report.conviction, 34); // 40 minus 2 per dropped claim (3 dropped)
  assert.equal(report.holdingView.thesisState, 'weakened');
  assert.equal(report.holdingView.redFlags.length, 0);
  const verifiedSell = verifyReport({ ...body, holdingView: { ...body.holdingView, redFlags: [{ text: 'Qualified opinion', sourceUrl: 'https://www.brecorder.com/a', quote: 'auditor issued a qualified opinion' }] } }, pack, seen);
  assert.equal(verifiedSell.report.holdingView.thesisState, 'broken');
});

test('cleanRanking keeps known tickers, caps weights and renumbers ranks', () => {
  const ranking = cleanRanking({ outlook: 'o', entries: [
    { ticker: 'bbb', rank: 2, conviction: 150, modelWeightPct: 60, note: 'n' },
    { ticker: 'AAA', rank: 1, conviction: 80, modelWeightPct: 35, note: 'n' },
    { ticker: 'ZZZ', rank: 3, conviction: 80, modelWeightPct: 35, note: 'n' },
    { ticker: 'AAA', rank: 4, conviction: 10, modelWeightPct: 5, note: 'dup' },
  ] }, ['AAA', 'BBB', 'CCC'], '2026-10', 'h', []);
  assert.deepEqual(ranking.entries.map((e) => [e.ticker, e.rank]), [['AAA', 1], ['BBB', 2]]);
  assert.equal(ranking.entries[1].conviction, 100);
  assert.ok(ranking.entries[1].modelWeightPct <= 35);
  assert.deepEqual(ranking.excluded.map((e) => e.ticker), ['CCC']);
});

test('pipeline: first run researches, second run reuses everything and makes no model call', async () => {
  const db = createD1();
  seed(db, 'AAA'); seed(db, 'BBB');
  const store = createStore(restLike(db));
  const calls = [];
  const first = await runResearch({ store, provider: fakeProvider(calls), config: config(), io: io(), tickers: ['AAA', 'BBB'], runId: 'r1' });
  assert.equal(first.status, 'completed');
  assert.deepEqual(first.outcomes.map((o) => o.decision).sort(), ['full', 'full']);
  assert.ok(calls.includes('macro') && calls.includes('rank') && calls.filter((c) => c.startsWith('company:')).length === 2);
  assert.ok(first.costUsd > 0 && first.costUsd < 5);
  const report = await store.getReport('AAA');
  assert.equal(report.report.evidence.length, 1, 'the unsupported fact key was dropped');
  assert.ok(report.report.conviction < 70);
  assert.ok(await store.getExtract('AAA', (await import('../lib/ai-research/reuse.ts')).sha256Hex ? await (await import('../lib/ai-research/reuse.ts')).sha256Hex('https://dps.psx.com.pk/download/doc/1.pdf') : ''));

  const again = [];
  const second = await runResearch({ store, provider: fakeProvider(again), config: config(), io: io(), tickers: ['AAA', 'BBB'], runId: 'r2' });
  assert.deepEqual(second.outcomes.map((o) => o.decision).sort(), ['fresh', 'fresh']);
  assert.deepEqual(again, [], 'nothing changed, so no model was called (macro brief and ranking were stored too)');
  assert.equal(second.costUsd, 0);
});

test('pipeline: a new announcement updates only that company and reuses its stored profile', async () => {
  const db = createD1();
  seed(db, 'AAA'); seed(db, 'BBB');
  const store = createStore(restLike(db));
  await runResearch({ store, provider: fakeProvider(), config: config(), io: io(), tickers: ['AAA', 'BBB'], runId: 'r1' });
  const changed = facts('AAA', { announcements: [{ date: '2026-10-18', title: 'Board meeting', category: 'Board Meetings', url: null }] });
  db.sqlite.prepare('UPDATE company_facts SET payload=? WHERE ticker=?').run(JSON.stringify(changed), 'AAA');
  const calls = [];
  const run = await runResearch({ store, provider: fakeProvider(calls), config: config(), io: io(), tickers: ['AAA', 'BBB'], runId: 'r2' });
  assert.deepEqual(run.outcomes.map((o) => `${o.ticker}:${o.decision}`).sort(), ['AAA:update', 'BBB:fresh']);
  assert.ok(calls.includes('company:AAA') && !calls.some((c) => c.startsWith('profile')) && !calls.includes('company:BBB'));
});

test('pipeline: an older unchanged report is carried forward without a model call', async () => {
  const db = createD1();
  seed(db, 'AAA');
  const store = createStore(restLike(db));
  await runResearch({ store, provider: fakeProvider(), config: config(), io: io(), tickers: ['AAA'], runId: 'r1' });
  const later = new Date(NOW.getTime() + 50 * 86_400_000);
  const calls = [];
  const run = await runResearch({ store, provider: fakeProvider(calls), config: config(), io: io({ now: () => later }), tickers: ['AAA'], runId: 'r2' });
  assert.equal(run.outcomes[0].decision, 'carry');
  assert.equal((await store.getReport('AAA')).carriedForward, true);
  assert.ok(!calls.some((c) => c.startsWith('company')));
});

test('pipeline: the monthly cap stops new calls and the run reports capped', async () => {
  const db = createD1();
  seed(db, 'AAA'); seed(db, 'BBB');
  const store = createStore(restLike(db));
  const run = await runResearch({ store, provider: fakeProvider(), config: config(0.001), io: io(), tickers: ['AAA', 'BBB'], runId: 'r1' });
  assert.equal(run.status, 'capped');
  assert.equal(run.calls, 0);
  assert.ok(run.costUsd <= 0.001);
  assert.ok(run.outcomes.every((o) => o.decision === 'skipped'));
});

test('pipeline: spend from earlier runs this month counts against the cap', async () => {
  const db = createD1();
  seed(db, 'AAA');
  const store = createStore(restLike(db));
  await store.startRun('old', '2026-10-02T00:00:00Z', 'openai', 'x');
  await store.finishRun('old', 'completed', 4.999, {}, null, '2026-10-02T01:00:00Z');
  const run = await runResearch({ store, provider: fakeProvider(), config: config(5), io: io(), tickers: ['AAA'], runId: 'r1' });
  assert.equal(run.status, 'capped');
  assert.equal(run.calls, 0);
});

test('pipeline: a company with no stored PSX data is skipped, not researched', async () => {
  const db = createD1();
  const store = createStore(restLike(db));
  const calls = [];
  const run = await runResearch({ store, provider: fakeProvider(calls), config: config(), io: io(), tickers: ['NOPE'], runId: 'r1' });
  assert.equal(run.outcomes[0].decision, 'skipped');
  assert.ok(!calls.some((c) => c.startsWith('company')));
});

test('fetch helpers accept only public https pages and strip html', () => {
  assert.ok(publicHttpsUrl('https://www.dawn.com/news/1'));
  for (const bad of ['http://dawn.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://user:pw@dawn.com', 'file:///etc/passwd', 'https://[::1]/'])
    assert.equal(publicHttpsUrl(bad), null, bad);
  assert.equal(htmlToText('<p>Hello&nbsp;<b>world</b></p><script>alert(1)</script>'), 'Hello world');
});

test('pdfToText reads text from a synthetic PDF in Node (the job runs on a GitHub runner)', async () => {
  const { bytes } = buildLedgerPdf(entries());
  const text = await pdfToText(bytes);
  assert.ok(text.length > 100);
  assert.match(text, /Account Opening Fee/);
});

test('older reports are rescored under the softer penalty, and the AI score is recoverable', async () => {
  const { effectiveConviction, aiConviction, MAX_PENALTY } = await import('../lib/ai-research/verify.ts');
  // Stored under the old rule: AI said 60, 6 claims dropped (-30), so 30 was saved.
  const old = { claims: 10, verified: 4, dropped: 6, convictionPenalty: 30 };
  assert.equal(effectiveConviction(30, old), 30 + 30 - MAX_PENALTY);
  assert.equal(aiConviction(30, old), 60);
  assert.equal(aiConviction(20, { ...old, bearAdjustment: -10 }), 60);
  assert.equal(effectiveConviction(55, { claims: 4, verified: 4, dropped: 0, convictionPenalty: 0 }), 55);
});
