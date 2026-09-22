import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCompany, assessAll, researchPlan, saveResearchPlanSnapshot } from '../lib/decision.ts';
import { DEFAULT_RESEARCH_POLICY, today, round } from '../lib/portfolio.ts';

const date = today();
const basePortfolio = () => ({
  companies: [{
    ticker: 'TEST', name: 'Test', sector: 'Bank', target: 10, approved: true,
    screenDate: date, note: '',
    screening: { source: 'PSX index', status: 'Pass', effectiveDate: date, reviewDueDate: date },
    approvedMaxPrice: 100, approvedResearchVersion: 1,
  }],
  trades: [], quotes: { TEST: { price: 90, date, asOf: date, source: 'https://dps.psx.com.pk/company/TEST', fetchedAt: new Date().toISOString() } },
  budgets: {},
  research: [{ ticker: 'TEST', status: 'Complete', score: 80, fairValue: 120, fairValueLow: 100, fairValueHigh: 140, valuationProvenance: 'scenario-model', stance: 'Consider', thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: date, researchRevision: 1 }],
});

test('a fully qualifying company is eligible with no exclusion reasons', () => {
  const a = assessCompany(basePortfolio(), DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, true);
  assert.deepEqual(a.exclusionReasons, []);
  assert.equal(a.stance, 'Consider');
  assert.equal(a.valuation.base, 120);
  assert.equal(a.effectiveQuote?.price, 90);
});

test('fixture 5: a Consider dossier with the purchase flag paused (approved:false) remains excluded', () => {
  const p = basePortfolio();
  p.companies[0].approved = false;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /not approved/i.test(r)));
});

test('Watchlist, Avoid, Research incomplete and no-dossier stances all exclude', () => {
  for (const stance of ['Watchlist', 'Avoid', 'Research incomplete']) {
    const p = basePortfolio();
    p.research[0].stance = stance;
    const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
    assert.equal(a.eligible, false, stance);
  }
  const noResearch = basePortfolio();
  noResearch.research = [];
  const a = assessCompany(noResearch, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.stance, 'None');
});

test('a superseded research approval is an unresolved critical condition', () => {
  const p = basePortfolio();
  p.research[0].researchRevision = 2;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.criticalConditions.length, 1);
  assert.ok(a.exclusionReasons.some((r) => r.includes('Unresolved')));
});

test('a same-day dossier re-save that bumps the revision counter still counts as superseded, even though updatedAt is unchanged', () => {
  const p = basePortfolio();
  // Same updatedAt as the approved snapshot, but the revision counter moved on
  // (e.g. the dossier was edited and saved again later the same day).
  p.research[0].updatedAt = date;
  p.research[0].researchRevision = 2;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.criticalConditions.length, 1);
  assert.ok(a.exclusionReasons.some((r) => r.includes('Unresolved')));
});

test('research that has never had a version explicitly approved excludes, even when every other condition is satisfied', () => {
  const p = basePortfolio();
  p.companies[0].approvedResearchVersion = null;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /has not been approved/i.test(r)));
});

test('research flagged "Update needed" is an unresolved critical condition, even with a stale Consider stance', () => {
  const p = basePortfolio();
  p.research[0].status = 'Update needed';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.criticalConditions.some((c) => /not Complete/i.test(c)));
  assert.ok(a.exclusionReasons.some((r) => r.includes('Unresolved') && /not Complete/i.test(r)));
});

test('a failed or overdue screening excludes; a missing screening excludes', () => {
  const failed = basePortfolio();
  failed.companies[0].screening.status = 'Fail';
  assert.equal(assessCompany(failed, DEFAULT_RESEARCH_POLICY, 'TEST', date).eligible, false);
  const overdue = basePortfolio();
  overdue.companies[0].screening.reviewDueDate = '2020-01-01';
  assert.equal(assessCompany(overdue, DEFAULT_RESEARCH_POLICY, 'TEST', date).eligible, false);
  const missing = basePortfolio();
  delete missing.companies[0].screening;
  const a = assessCompany(missing, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.screening, null);
});

test('a Pending screening excludes with a reason distinct from Fail and from missing screening', () => {
  const p = basePortfolio();
  p.companies[0].screening.status = 'Pending';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /pending/i.test(r)));
  assert.ok(!a.exclusionReasons.some((r) => /failed shariah/i.test(r)));
  assert.ok(!a.exclusionReasons.some((r) => /no recorded/i.test(r)));
});

test('a screening with an empty source excludes, even with valid status and dates', () => {
  const p = basePortfolio();
  p.companies[0].screening.source = '';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /screening source/i.test(r)));
});

test('a screening with an empty effective date excludes', () => {
  const p = basePortfolio();
  p.companies[0].screening.effectiveDate = '';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /effective date/i.test(r)));
});

test('a screening with a future effective date excludes as not yet in effect', () => {
  const p = basePortfolio();
  p.companies[0].screening.effectiveDate = '2099-01-01';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /not yet in effect/i.test(r)));
});

test('a quote priced above the approved maximum excludes; a missing quote excludes under a today-only policy', () => {
  const expensive = basePortfolio();
  expensive.quotes.TEST.price = 150;
  assert.equal(assessCompany(expensive, DEFAULT_RESEARCH_POLICY, 'TEST', date).eligible, false);
  const stale = basePortfolio();
  stale.quotes.TEST.date = '2020-01-01';
  const a = assessCompany(stale, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.effectiveQuote, null);
});

test('a dated-quote policy accepts a quote within the configured age and rejects one older', () => {
  const p = basePortfolio();
  p.quotes.TEST.date = '2026-09-15';
  const dated = { ...DEFAULT_RESEARCH_POLICY, quoteFreshness: 'dated', maxQuoteAgeDays: 10 };
  const withinAge = assessCompany(p, dated, 'TEST', '2026-09-20');
  assert.ok(withinAge.effectiveQuote);
  const tooOld = assessCompany(p, dated, 'TEST', '2026-09-30');
  assert.equal(tooOld.effectiveQuote, null);
});

test('no approved maximum purchase price excludes even with a cheap accepted quote', () => {
  const p = basePortfolio();
  p.companies[0].approvedMaxPrice = null;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /maximum purchase price/i.test(r)));
});

test('an unclassified sector blocks eligibility even when otherwise qualifying', () => {
  const p = basePortfolio();
  p.companies[0].sector = '';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.sectorHeadroomPct, null);
  assert.ok(a.exclusionReasons.some((r) => /sector not classified/i.test(r)));
});

test('an unpriced holding in the same sector blocks eligibility even when a naive calculation would show headroom', () => {
  const p = basePortfolio();
  p.companies.push({
    ticker: 'OTHERBANK', name: 'Other Bank', sector: 'Bank', target: 0,
    approved: false, screenDate: '', note: '',
  });
  // OTHERBANK has shares but no quote entry at all, so holdings() reports value: null for it.
  p.trades.push({ id: '2', ticker: 'OTHERBANK', kind: 'opening', date, shares: 50, price: null, fees: 0, month: '', note: '' });
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.sectorHeadroomPct, null);
  assert.ok(a.exclusionReasons.some((r) => /cannot be confirmed/i.test(r)));
});

test('being at or above target, company cap or sector cap excludes on headroom, computed from real holdings', () => {
  const p = basePortfolio();
  p.trades = [{ id: '1', ticker: 'TEST', kind: 'opening', date, shares: 100, price: null, fees: 0, month: '', note: '' }];
  p.companies[0].target = 1;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.currentExposurePct > 0);
  assert.ok(a.exclusionReasons.some((r) => /at or above target/i.test(r)));
});

test('assessAll returns one assessment per company, in company order', () => {
  const p = basePortfolio();
  p.companies.push({ ticker: 'OTHER', name: 'Other', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  const all = assessAll(p, DEFAULT_RESEARCH_POLICY, date);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((a) => a.ticker), ['TEST', 'OTHER']);
});

test('a single eligible company gets shares up to its target gap, bounded by availableToSpend', () => {
  const p = basePortfolio();
  // basePortfolio's single TEST company defaults to a 10% target (fine for
  // the assessCompany-only tests above), which on its own fails researchPlan's
  // target-weights-must-total-100% check, and basePortfolio sets no funding
  // entries, which per confirmedFunds() leaves availableToSpend at 0 — both
  // would keep shares at 0 regardless of eligibility, so set them here for a
  // realistic single-company scenario.
  p.companies[0].target = 100;
  p.budgets = { [date.slice(0, 7)]: 100000 };
  p.funding = [{ id: 'f1', month: date.slice(0, 7), source: 'manual', amount: 100000, note: '', createdAt: new Date().toISOString() }];
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  const row = r.rows.find((x) => x.ticker === 'TEST');
  assert.equal(row.eligible, true);
  assert.ok(row.shares > 0);
  assert.equal(r.errors.length, 0);
});

test('fixture 1: five Watchlist companies at 20% target, priced at 2x fair value, allocate zero with reasons', () => {
  const p = { companies: [], trades: [], quotes: {}, budgets: { [date.slice(0, 7)]: 500000 }, research: [] };
  for (const ticker of ['A', 'B', 'C', 'D', 'E']) {
    p.companies.push({ ticker, name: ticker, sector: 'Bank', target: 20, approved: true, screenDate: date, note: '', screening: { source: 'x', status: 'Pass', effectiveDate: date, reviewDueDate: date }, approvedMaxPrice: 1000, approvedResearchVersion: 1 });
    p.quotes[ticker] = { price: 200, date, asOf: date, source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt: new Date().toISOString() };
    p.research.push({ ticker, status: 'Complete', score: 50, fairValue: 100, fairValueLow: 80, fairValueHigh: 120, valuationProvenance: 'scenario-model', stance: 'Watchlist', researchRevision: 1, thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: date });
  }
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  for (const row of r.rows) {
    assert.equal(row.eligible, false);
    assert.equal(row.shares, 0);
    assert.ok(row.exclusionReasons.some((x) => /not Consider/i.test(x)));
  }
  assert.equal(r.invested, 0);
});

test('fixture 4: an overweight holding and an overweight sector receive no new contribution, no sell suggested', () => {
  const p = basePortfolio();
  p.trades = [{ id: 'op', ticker: 'TEST', kind: 'opening', date, shares: 1000, price: null, fees: 0, month: '', note: '' }];
  p.companies[0].target = 5;
  p.budgets = { [date.slice(0, 7)]: 100000 };
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  const row = r.rows.find((x) => x.ticker === 'TEST');
  assert.equal(row.gap, 0);
  assert.equal(row.shares, 0);
  assert.ok(!r.rows.some((x) => x.shares < 0));
});

test('fixture 8: multiple eligible companies in one sector, expensive shares, fees, small budget, deterministic ties, no cap breach, no negative residual', () => {
  const month = date.slice(0, 7);
  // Budget large enough that the default 20% company cap can clear at least
  // one fee-inclusive share (so the test genuinely allocates rather than
  // short-circuiting on either an unfunded month or an uncapturable cap),
  // while still small relative to full target satisfaction, exercising both
  // the proportional first pass and the greedy leftover pass.
  const budget = 20000;
  const p = { companies: [], trades: [], quotes: {}, budgets: { [month]: budget }, research: [] };
  p.funding = [{ id: 'f1', month, source: 'manual', amount: budget, note: '', createdAt: new Date().toISOString() }];
  const targets = { A: 34, B: 33, C: 33 };
  for (const ticker of ['A', 'B', 'C']) {
    p.companies.push({ ticker, name: ticker, sector: 'Bank', target: targets[ticker], approved: true, screenDate: date, note: '', screening: { source: 'x', status: 'Pass', effectiveDate: date, reviewDueDate: date }, approvedMaxPrice: 5000, approvedResearchVersion: 1 });
    p.quotes[ticker] = { price: 1200, date, asOf: date, source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt: new Date().toISOString() };
    p.research.push({ ticker, status: 'Complete', score: 90, fairValue: 1500, fairValueLow: 1300, fairValueHigh: 1700, valuationProvenance: 'scenario-model', stance: 'Consider', researchRevision: 1, thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: date });
  }
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, month, 1.5, date);
  assert.equal(r.errors.length, 0);
  assert.ok(r.invested > 0);
  assert.ok(r.invested <= budget);
  assert.ok(r.leftover >= 0);
  assert.equal(round(r.invested + r.leftover), round(r.availableToSpend));
  for (const row of r.rows) assert.ok(Number.isInteger(row.shares));
  const post = r.total + r.availableToSpend;
  const sectorCapAmount = (DEFAULT_RESEARCH_POLICY.sectorCapPct / 100) * post;
  assert.ok(r.rows.reduce((a, row) => a + row.amount, 0) <= sectorCapAmount + 1e-9);
  // Run twice with identical inputs — deterministic tie-breaking means identical output.
  const r2 = researchPlan(p, DEFAULT_RESEARCH_POLICY, month, 1.5, date);
  assert.deepEqual(r.rows.map((x) => x.shares), r2.rows.map((x) => x.shares));
});

test('a tight sector cap that binds across multiple eligible companies splits fairly rather than first-come-first-served, and never breaches the cap', () => {
  const month = date.slice(0, 7);
  const policy = { ...DEFAULT_RESEARCH_POLICY, companyCapPct: 50, sectorCapPct: 20 };
  const p = { companies: [], trades: [], quotes: {}, budgets: { [month]: 100000 }, research: [] };
  p.funding = [{ id: 'f1', month, source: 'manual', amount: 100000, note: '', createdAt: new Date().toISOString() }];
  for (const ticker of ['X', 'Y']) {
    p.companies.push({ ticker, name: ticker, sector: 'Bank', target: 50, approved: true, screenDate: date, note: '', screening: { source: 'x', status: 'Pass', effectiveDate: date, reviewDueDate: date }, approvedMaxPrice: 100, approvedResearchVersion: 1 });
    p.quotes[ticker] = { price: 10, date, asOf: date, source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt: new Date().toISOString() };
    p.research.push({ ticker, status: 'Complete', score: 90, fairValue: 15, fairValueLow: 12, fairValueHigh: 18, valuationProvenance: 'scenario-model', stance: 'Consider', researchRevision: 1, thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: date });
  }
  const r = researchPlan(p, policy, month, 0, date);
  const x = r.rows.find((row) => row.ticker === 'X');
  const y = r.rows.find((row) => row.ticker === 'Y');
  const post = r.total + r.availableToSpend;
  const sectorCapAmount = (policy.sectorCapPct / 100) * post;
  const sectorSpend = x.amount + y.amount;
  assert.ok(sectorSpend <= sectorCapAmount + 1e-9);
  assert.ok(x.shares > 0, 'X should not be starved to zero purely by list order');
  assert.ok(y.shares > 0, 'Y should not be starved to zero purely by list order');
  // Reversing company order must not change who gets allocated what.
  const reversed = { ...p, companies: [...p.companies].reverse() };
  const r2 = researchPlan(reversed, policy, month, 0, date);
  const x2 = r2.rows.find((row) => row.ticker === 'X');
  const y2 = r2.rows.find((row) => row.ticker === 'Y');
  assert.equal(x2.shares, x.shares);
  assert.equal(y2.shares, y.shares);
});

test('availableToSpend is bounded by the lesser of remaining budget and remaining confirmed funds', () => {
  const p = basePortfolio();
  p.budgets = { [date.slice(0, 7)]: 100000 };
  p.funding = [{ id: 'f1', month: date.slice(0, 7), source: 'manual', amount: 150, note: '', createdAt: new Date().toISOString() }];
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  assert.equal(r.confirmedFunds, 150);
  assert.equal(r.availableToSpend, 150);
  assert.ok(r.invested <= 150);
});

test('target weights not summing to 100% blocks allocation with an error, same as plan()', () => {
  const p = basePortfolio();
  p.companies[0].target = 50;
  p.budgets = { [date.slice(0, 7)]: 100000 };
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  assert.ok(r.errors.some((e) => /100%/.test(e)));
  assert.equal(r.invested, 0);
});

test('saveResearchPlanSnapshot freezes a plain, independent copy of the plan result', () => {
  const p = basePortfolio();
  p.budgets = { [date.slice(0, 7)]: 100000 };
  const result = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  const snap = saveResearchPlanSnapshot(result, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, new Date().toISOString());
  assert.equal(snap.month, date.slice(0, 7));
  assert.equal(snap.invested, result.invested);
  assert.equal(snap.rows.length, result.rows.length);
  assert.deepEqual(snap.policySnapshot, DEFAULT_RESEARCH_POLICY);
  // Mutating the original result must not affect the already-captured snapshot.
  result.rows[0].shares = 999999;
  assert.notEqual(snap.rows[0].shares, 999999);
});
