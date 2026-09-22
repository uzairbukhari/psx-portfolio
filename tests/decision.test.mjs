import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCompany, assessAll } from '../lib/decision.ts';
import { DEFAULT_RESEARCH_POLICY, today } from '../lib/portfolio.ts';

const date = today();
const basePortfolio = () => ({
  companies: [{
    ticker: 'TEST', name: 'Test', sector: 'Bank', target: 10, approved: true,
    screenDate: date, note: '',
    screening: { source: 'PSX index', status: 'Pass', effectiveDate: date, reviewDueDate: date },
    approvedMaxPrice: 100, approvedResearchVersion: date,
  }],
  trades: [], quotes: { TEST: { price: 90, date, asOf: date, source: 'https://dps.psx.com.pk/company/TEST', fetchedAt: new Date().toISOString() } },
  budgets: {},
  research: [{ ticker: 'TEST', status: 'Complete', score: 80, fairValue: 120, fairValueLow: 100, fairValueHigh: 140, valuationProvenance: 'scenario-model', stance: 'Consider', thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: date }],
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
  p.research[0].updatedAt = '2026-09-25';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.criticalConditions.length, 1);
  assert.ok(a.exclusionReasons.some((r) => r.includes('Unresolved')));
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
