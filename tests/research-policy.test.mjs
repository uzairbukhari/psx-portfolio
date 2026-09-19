import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESEARCH_BUDGET_MICROS,
  correctFiscalYearLabels,
  describeNullFinancialFields,
  hasPdfSignature,
  normalizeAnnualFinancials,
  normalizeValuationScenarios,
  financialValueSupported,
  FINANCIAL_VALUE_LABELS,
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

test('matches financial values to labelled source lines across unit conversions', () => {
  const evidence = 'Net Sales Rs in billion 401.18 463.70\nProfit for the year (Rupees in thousand) 169,900,000\nEarnings per Share 39.50';
  assert.equal(financialValueSupported(evidence, /net sales/i, 401_180), true);
  assert.equal(financialValueSupported(evidence, /profit for the year/i, 169_900), true);
  assert.equal(financialValueSupported(evidence, /earnings per share/i, 39.5), true);
  assert.equal(financialValueSupported(evidence, /earnings per share/i, 52.23), false);
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

test('corrects fiscal years mislabelled by their FY-range start year instead of end year', () => {
  const mislabelled = [
    { ...annual(2024), source: 'OGDCL Annual Report 2025 (Consolidated, FY2024-25)' },
    { ...annual(2023), source: 'OGDCL Annual Report 2025 (Consolidated, FY2023-24)' },
    { ...annual(2022), source: 'OGDCL Annual Report 2025 (Consolidated, FY2022-23)' },
    { ...annual(2021), source: 'OGDCL Annual Report 2025 (Consolidated, FY2021-22)' },
    { ...annual(2020), source: 'OGDCL Annual Report 2025 (Six Year Performance, FY2020-21)' },
  ];
  const corrected = correctFiscalYearLabels(mislabelled);
  assert.deepEqual(corrected.map((row) => row.year), [2025, 2024, 2023, 2022, 2021]);
  assert.doesNotThrow(() => validateInvestmentDossier({
    financials: corrected,
    scores: [16, 15, 10, 7, 8, 9, 6],
    scoreNotes: Array(7).fill(scoreNote),
    scenarios: [
      { name: 'Bear', eps: 30, multiple: 5 }, { name: 'Base', eps: 35, multiple: 6 }, { name: 'Bull', eps: 40, multiple: 7 },
    ],
  }, 200, 2026));
});

test('leaves fiscal years unchanged when no FY-range or Annual Report year is cited', () => {
  const rows = [2025, 2024, 2023, 2022, 2021].map(annual);
  assert.deepEqual(correctFiscalYearLabels(rows), rows);
});

test('does not collapse distinct years that correctly share one common report citation', () => {
  // Five rows read off ONE multi-year table, all correctly citing that same
  // report - the pattern this system explicitly asks the model to use. A
  // real regression: this used to collapse to [2025,2025,2025,2022,2021]
  // (3 distinct years) because a since-removed fallback rewrote any row's
  // year to the report's own naming year whenever within 2 years of it.
  const rows = [2025, 2024, 2023, 2022, 2021].map((year) => ({
    ...annual(year),
    source: 'Annual Report 2025',
    basis: 'Company (unconsolidated) — six year performance table',
  }));
  assert.deepEqual(
    correctFiscalYearLabels(rows).map((row) => row.year),
    [2025, 2024, 2023, 2022, 2021],
  );
});

test('recognizes the singular "Shareholders’ Fund" label used by real PSX six-year performance tables', () => {
  const evidence = 'Shareholders’ Fund\tRs in billion\t711\t770\t875\t1,083\t1,250\t1,348';
  assert.equal(financialValueSupported(evidence, FINANCIAL_VALUE_LABELS.equity, 1_250_000), true);
  assert.equal(financialValueSupported(evidence, FINANCIAL_VALUE_LABELS.equity, 1_083_000), true);
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
  const negativeDps = { ...base, financials: [2025, 2024, 2023, 2022, 2021].map(annual) };
  negativeDps.financials[0] = { ...negativeDps.financials[0], dividend: -1 };
  assert.throws(() => validateInvestmentDossier(negativeDps, 200, 2026), /cannot be negative/);
});

test('allows equity and dividend to be null when genuinely unavailable, without failing validation', () => {
  const financials = [2025, 2024, 2023, 2022, 2021].map(annual);
  financials[0] = { ...financials[0], dividend: null };
  financials[1] = { ...financials[1], equity: null };
  assert.doesNotThrow(() => validateInvestmentDossier({
    financials,
    scores: [16, 15, 10, 7, 8, 9, 6],
    scoreNotes: Array(7).fill(scoreNote),
    scenarios: [
      { name: 'Bear', eps: 30, multiple: 5 }, { name: 'Base', eps: 35, multiple: 6 }, { name: 'Bull', eps: 40, multiple: 7 },
    ],
  }, 200, 2026));
});

test('describes which year and field is missing when a financial value is null', () => {
  const financials = [2025, 2024].map(annual);
  financials[0] = { ...financials[0], dividend: null };
  financials[1] = { ...financials[1], equity: null, ocf: null };
  assert.deepEqual(describeNullFinancialFields(financials), ['2025 dividend', '2024 equity', '2024 ocf']);
  assert.deepEqual(describeNullFinancialFields([]), []);
  assert.deepEqual(describeNullFinancialFields(null), []);
});
