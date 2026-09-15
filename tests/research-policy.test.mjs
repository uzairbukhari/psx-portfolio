import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESEARCH_BUDGET_MICROS,
  hasPdfSignature,
  normalizeAnnualFinancials,
  normalizeValuationScenarios,
  researchReserveMicros,
  validateInvestmentDossier,
  validPsxTicker,
  validScorecard,
} from '../lib/research-policy.mjs';

test('research reservation remains below the per-company cap for the bounded request', () => {
  const reserve = researchReserveMicros(900_000, 14_000);
  assert.ok(reserve > 0);
  assert.ok(reserve < RESEARCH_BUDGET_MICROS);
});

test('seven-category scores enforce framework limits and preserve null gaps', () => {
  assert.equal(validScorecard([18, 17, 12, 8, null, 11, 7]), true);
  assert.equal(validScorecard([21, 17, 12, 8, 7, 11, 7]), false);
  assert.equal(validScorecard([18, 17, 12, 8, 7]), false);
});

test('PDF validation rejects HTML returned by an official-looking URL', () => {
  assert.equal(hasPdfSignature(Buffer.from('%PDF-1.7\n')), true);
  assert.equal(
    hasPdfSignature(Buffer.from('<html>Access denied</html>')),
    false,
  );
});

test('ticker validation accepts PSX symbols and rejects path-like input', () => {
  assert.equal(validPsxTicker('MEBL'), true);
  assert.equal(validPsxTicker('786'), true);
  assert.equal(validPsxTicker('../MEBL'), false);
});

const scoreNote = 'Evidence: Annual Report 2025, page 65. The audited trend supports the assigned score across the five-year record. Material operating risks and evidence limitations prevent a maximum score.';
const annual = (year) => ({
  year, revenue: 100_000, profit: 20_000, eps: 10, ocf: 22_000,
  debt: 5_000, equity: 80_000, dividend: 4,
  source: `Annual Report ${year}`, page: '10',
  basis: 'Consolidated, PKR million', verified: true,
});

test('normalizes monetary figures reported in PKR thousands', () => {
  const [row] = normalizeAnnualFinancials([
    { ...annual(2025), revenue: 473_761_000, profit: 169_902_000, eps: 39.5 },
  ]);
  assert.equal(row.revenue, 473_761);
  assert.equal(row.profit, 169_902);
  assert.equal(row.eps, 39.5);
});

test('normalizes valuation scenarios into conservative display order', () => {
  const scenarios = normalizeValuationScenarios([
    { name: 'Base', eps: 35, multiple: 6 },
    { name: 'Bull', eps: 40, multiple: 7 },
    { name: 'Bear', eps: 30, multiple: 5 },
  ]);
  assert.deepEqual(scenarios.map((item) => item.name), ['Bear', 'Base', 'Bull']);
});

test('rejects the prior unsafe dossier shape', () => {
  assert.throws(() => validateInvestmentDossier({
    financials: [annual(2026), annual(2025)],
    scores: [20, 20, 15, 10, 10, 15, 10],
    scoreNotes: Array(7).fill(scoreNote),
    scenarios: Array(3).fill({ eps: null, multiple: null }),
  }, null), /Five directly cited annual periods/);
});

test('accepts a cited five-year dossier with ordered valuation and strict scores', () => {
  assert.doesNotThrow(() => validateInvestmentDossier({
    financials: [2025, 2024, 2023, 2022, 2021].map(annual),
    scores: [16, 15, 10, 7, 8, 9, 6],
    scoreNotes: Array(7).fill(scoreNote),
    scenarios: [
      { name: 'Bear', eps: 30, multiple: 5 }, { name: 'Base', eps: 35, multiple: 6 }, { name: 'Bull', eps: 40, multiple: 7 },
    ],
  }, 200));
});

test('rejects shallow score explanations and identifies their categories', () => {
  assert.throws(() => validateInvestmentDossier({
    financials: [2025, 2024, 2023, 2022, 2021].map(annual),
    scores: [16, 15, 10, 7, 8, 9, 6],
    scoreNotes: Array(7).fill('Evidence: Annual Report 2025, page 65. Too brief.'),
    scenarios: [
      { name: 'Bear', eps: 30, multiple: 5 },
      { name: 'Base', eps: 35, multiple: 6 },
      { name: 'Bull', eps: 40, multiple: 7 },
    ],
  }, 200, 2026), /Invalid score categories: 1, 2, 3, 4, 5, 6, 7/);
});

test('rejects stale fiscal labels, broken units, and missing latest DPS', () => {
  const base = {
    financials: [2024, 2023, 2022, 2021, 2020].map(annual),
    scores: [16, 15, 10, 7, 8, 9, 6],
    scoreNotes: Array(7).fill(scoreNote),
    scenarios: [
      { name: 'Bear', eps: 30, multiple: 5 }, { name: 'Base', eps: 35, multiple: 6 }, { name: 'Bull', eps: 40, multiple: 7 },
    ],
  };
  assert.throws(() => validateInvestmentDossier(base, 200, 2026), /five latest consecutive/);
  const wrongUnits = { ...base, financials: [2025, 2024, 2023, 2022, 2021].map(annual) };
  wrongUnits.financials[0] = { ...wrongUnits.financials[0], equity: 100, dividend: 4 };
  assert.throws(() => validateInvestmentDossier(wrongUnits, 200, 2026), /units are internally inconsistent/);
  const missingDps = { ...base, financials: [2025, 2024, 2023, 2022, 2021].map(annual) };
  missingDps.financials[0] = { ...missingDps.financials[0], dividend: null };
  assert.throws(() => validateInvestmentDossier(missingDps, 200, 2026), /dividend per share/);
});
