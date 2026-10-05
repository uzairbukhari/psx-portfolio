import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { buildPublicAnalysis } from '../lib/public-analysis.ts';
import { heldValues, recordRun, runLocalPicks, MAX_STORED_RUNS } from '../lib/picks-local.ts';
import { blankPortfolio, today, validate } from '../lib/portfolio.ts';

const day = today();
const q = (period, eps) => ({ period, revenue: null, pat: null, eps });
const facts = (ticker, over = {}) => ({
  ticker, name: `${ticker} Ltd`, sector: 'CEMENT', price: 100, priceDate: day, peTtm: 8,
  week52: { low: 50, high: 150 }, change1y: 20, changeYtd: 5, marketCapThousands: 1, freeFloatPct: 20,
  annual: [q('2026', 16), q('2025', 8)], quarterly: [q('Q3 2026', 5), q('Q2 2026', 4), q('Q1 2026', 3), q('Q4 2025', 2), q('Q3 2025', 1)],
  ratios: { grossMargin: [], netMargin: [], epsGrowth: [], peg: [] }, announcements: [],
  source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt: `${day}T10:00:00Z`, ...over,
});

async function seeded() {
  const db = createD1();
  for (const ticker of ['AAA', 'BBB'])
    await db.prepare('INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES (?,?,?,?)')
      .bind(ticker, day, JSON.stringify(facts(ticker)), `${day}T10:00:00Z`).run();
  return db;
}

test('public analysis answers for client-named tickers and reports missing ones honestly', async () => {
  const db = await seeded();
  const analysis = await buildPublicAnalysis(db, ['AAA', 'BBB', 'ZZZ']);
  assert.deepEqual(analysis.facts.map((f) => [f.ticker, f.state]), [['AAA', 'fresh'], ['BBB', 'fresh'], ['ZZZ', 'missing']]);
  assert.equal(analysis.companies.find((c) => c.ticker === 'ZZZ').metrics.unavailable.includes('No PSX company data'), true);
  assert.equal(analysis.scores.length, 3);
});

test('a local run ranks public data and sizes it against the device holdings only', async () => {
  const db = await seeded();
  const analysis = await buildPublicAnalysis(db, ['AAA', 'BBB']);
  const run = runLocalPicks({
    analysis, month: '2026-10', amount: 100_000, feePct: 0, shortlist: ['AAA', 'BBB'],
    holdings: [{ ticker: 'AAA', valuePkr: 900_000 }], now: new Date(), id: 'run-1',
  });
  assert.equal(run.status, 'completed');
  assert.equal(run.method, 'quant');
  assert.equal(run.result.sizing.holdingsFingerprint.length > 0, true);
  const total = run.result.picks.reduce((sum, p) => sum + p.allocationPct, 0) + run.result.unallocatedPct;
  assert.ok(Math.abs(total - 100) < 0.05);
  // The run is stored inside the portfolio and survives validation.
  const portfolio = { ...blankPortfolio(), monthlyPicksRuns: recordRun(undefined, run) };
  assert.doesNotThrow(() => validate(portfolio));
});

test('a run with no usable company data fails with a reason instead of inventing picks', async () => {
  const analysis = await buildPublicAnalysis(createD1(), ['QQQ']);
  const run = runLocalPicks({ analysis, month: '2026-10', amount: 50_000, feePct: 0, shortlist: ['QQQ'], holdings: [] });
  assert.equal(run.status, 'failed');
  assert.equal(run.result, null);
  assert.match(run.error, /No shortlisted company/);
});

test('history is newest first, de-duplicated and bounded', () => {
  let runs;
  for (let i = 0; i < MAX_STORED_RUNS + 4; i++)
    runs = recordRun(runs, { id: `r${i}`, month: '2026-10', amount: 1, feePct: 0, shortlist: [], status: 'failed', result: null, error: 'x', model: 'quant', estimatedCostUsd: 0, createdAt: '', updatedAt: '', workflowVersion: 10, method: 'quant', dataAsOf: null });
  assert.equal(runs.length, MAX_STORED_RUNS);
  assert.equal(runs[0].id, `r${MAX_STORED_RUNS + 3}`);
  assert.equal(recordRun(runs, { ...runs[3] }).length, MAX_STORED_RUNS);
});

test('only held positions with shares are valued', () => {
  assert.deepEqual(heldValues(blankPortfolio()), []);
});

test('validation rejects a malformed stored history', () => {
  const p = { ...blankPortfolio(), monthlyPicksRuns: [{ id: 'x', month: 'bad' }] };
  assert.throws(() => validate(p), /Monthly Picks history/);
});

test('a run can be created where there is no global crypto (Hermes on the phone)', async () => {
  const db = await seeded();
  const analysis = await buildPublicAnalysis(db, ['AAA']);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const run = runLocalPicks({ analysis, month: '2026-10', amount: 50_000, feePct: 0, shortlist: ['AAA'], holdings: [] });
    assert.equal(typeof run.id, 'string');
    assert.ok(run.id.length > 8);
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
  }
});
