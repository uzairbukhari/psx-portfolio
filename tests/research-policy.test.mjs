import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESEARCH_BUDGET_MICROS,
  correctFiscalYearLabels,
  describeNullFinancialFields,
  describeScorecardIssues,
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
import { citedPageText } from '../lib/research-evidence.mjs';

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

test('names exactly which score categories exceeded their cap', () => {
  // Real case: Dividend quality (max 10) came back as 14, Risk resilience
  // (max 10) as 12 - a generic "did not pass validation" message gave the
  // self-correction loop nothing concrete to fix on retry.
  assert.equal(
    describeScorecardIssues([16, 17, 12, 8, 14, 11, 12]),
    'Dividend quality score 14 exceeds its maximum of 10; Risk resilience score 12 exceeds its maximum of 10',
  );
  assert.equal(describeScorecardIssues([18, 17, 12, 8, null, 11, 7]), '');
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

test('matches a chart caption to its data-point value on a different reconstructed line, same page', () => {
  // Real case: MARI's annual report renders its six-year history as bar
  // charts, not a text table. pdf.js emits the chart's title/caption and
  // each bar's own value label as separate text runs at different
  // y-positions, landing several reconstructed lines apart even for a
  // completely genuine, correctly-cited figure (verified against the real
  // report - see lib/research-policy.mjs).
  const evidence = '--- PDF PAGE 131 ---\n' +
    'Net Sales Exploration & Prospecting Expenditure Net Profit\n' +
    '(Rupees in billion) (Rupees in billion) (Rupees in billion)\n' +
    '181.83 177.10\n' +
    '145.77\n' +
    '95.13\n' +
    '31.44 33.06\n' +
    '72.03 73.02 30.31';
  assert.equal(financialValueSupported(evidence, /net sales/i, 95_130), true);
  assert.equal(financialValueSupported(evidence, /profit (?:for|after)|profit after taxation|net profit/i, 33_063), true);
});

test('matches revenue labelled "Turnover" instead of "Net Sales" or "Revenue"', () => {
  // Real case (LUCK): the six-year "Financial Highlights" table's own
  // profit/EPS/equity rows verified fine against the same page, but the
  // top-line row was captioned "Turnover" (a common alternate label in
  // Pakistani financial-statement tables) rather than "Net Sales",
  // "Sales", "Revenue" or "Total income" - the only four synonyms
  // FINANCIAL_VALUE_LABELS.revenue recognized, so a correctly-cited
  // figure was rejected as unsupported on every self-correction attempt.
  const evidence = 'Turnover 81,094';
  assert.equal(financialValueSupported(evidence, FINANCIAL_VALUE_LABELS.revenue, 81_094), true);
});

test('matches a value printed as bare, unscaled Rupees on a raw statement page', () => {
  // Real case: a company's Six/Five Year highlights table (the primary
  // report's summary page) prints figures "Rupees in million" or
  // "in billion", but its own primary financial statements - Statement of
  // Financial Position, Profit or Loss - commonly print amounts as bare,
  // unformatted Rupees with no "million"/"thousand" notation at all. Older
  // fiscal years that fall outside the primary report's own summary table
  // get sourced from exactly those raw-Rupee statement pages (see
  // lib/research-evidence.mjs: only the primary document's highlights
  // table gets the "tables" priority bonus; every other document's pages
  // only surface via the "statements" regex). The dossier reports the
  // figure correctly converted to PKR million, but the ratio between the
  // raw evidence and the reported value is 1,000,000x, not 1,000x - a
  // scale the matcher never tried, so a correct citation was rejected.
  const evidence = 'Total equity 83,456,789,012';
  assert.equal(financialValueSupported(evidence, FINANCIAL_VALUE_LABELS.equity, 83_457), true);
});

test('does not match a value from an unrelated, different page', () => {
  const evidence = '--- PDF PAGE 1 ---\nNet Sales 401.18\n--- PDF PAGE 2 ---\nUnrelated commentary 33.06';
  assert.equal(financialValueSupported(evidence, /net sales/i, 33_060), false);
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

test('validateInvestmentDossier computes fair values via the shared scenario module, not raw positional multiplication', () => {
  assert.doesNotThrow(() => validateInvestmentDossier({
    financials: [2025, 2024, 2023, 2022, 2021].map(annual),
    scores: [16, 15, 10, 7, 8, 9, 6],
    scoreNotes: Array(7).fill(scoreNote),
    scenarios: [
      { name: 'Bear', eps: 8, multiple: 13 },
      { name: 'Base', eps: 10, multiple: 16 },
      { name: 'Bull', eps: 12, multiple: 19 },
    ],
  }, 150));
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

test('allows a bank\'s operating cash flow to exceed revenue several times over', () => {
  // Real case (MEBL, Meezan Bank): OCF of Rs 881bn vs Total Income of
  // Rs 285bn (~3.1x) is normal for a deposit-taking bank - its operating
  // cash flow is dominated by customer deposit/placement/advance
  // movements that have nothing to do with revenue's magnitude. The
  // ocf > revenue*2 sanity check exists to catch a genuine PKR
  // billion/thousand unit-conversion mistake, but that heuristic only
  // holds for a non-financial company; applied to a bank it rejected a
  // correct, fully cited dossier on every self-correction attempt.
  const base = {
    financials: [2025, 2024, 2023, 2022, 2021].map(annual),
    scores: [16, 15, 10, 7, 8, 9, 6],
    scoreNotes: Array(7).fill(scoreNote),
    scenarios: [
      { name: 'Bear', eps: 30, multiple: 5 }, { name: 'Base', eps: 35, multiple: 6 }, { name: 'Bull', eps: 40, multiple: 7 },
    ],
  };
  const bank = {
    ...base,
    sector: 'Commercial Banks (Islamic)',
    financials: base.financials.map((row, i) => (i === 0 ? { ...row, revenue: 285_104, ocf: 881_296 } : row)),
  };
  assert.doesNotThrow(() => validateInvestmentDossier(bank, 200, 2026));
  const nonBank = { ...bank, sector: 'Cement' };
  assert.throws(() => validateInvestmentDossier(nonBank, 200, 2026), /units are internally inconsistent/);
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

test('flags an implausible dividend only for the newest year, not a historical one', () => {
  // A bonus or rights issue restates EPS for comparability, but a
  // dividend a company actually declared in an older year was never
  // restated - real case (MARI, an 800% bonus event around FY2024): two
  // different models independently read the same dividend figures from
  // the same evidence, ruling out model error, yet they looked 3-4x EPS
  // for the historical years only. The prompt already tells the model to
  // preserve and flag such a break rather than invent an adjusted series,
  // so only the newest year - the one that matters for a current
  // decision, and which can't have this historical distortion - is
  // checked against EPS.
  const base = {
    financials: [2025, 2024, 2023, 2022, 2021].map(annual),
    scores: [16, 15, 10, 7, 8, 9, 6],
    scoreNotes: Array(7).fill(scoreNote),
    scenarios: [
      { name: 'Bear', eps: 30, multiple: 5 }, { name: 'Base', eps: 35, multiple: 6 }, { name: 'Bull', eps: 40, multiple: 7 },
    ],
  };
  const historicalOnly = {
    ...base,
    financials: base.financials.map((row, i) => (i === 4 ? { ...row, dividend: 124 } : row)),
  };
  assert.doesNotThrow(() => validateInvestmentDossier(historicalOnly, 200, 2026));
  const newestImplausible = {
    ...base,
    financials: base.financials.map((row, i) => (i === 0 ? { ...row, dividend: 124 } : row)),
  };
  assert.throws(() => validateInvestmentDossier(newestImplausible, 200, 2026), /Dividend per share is implausible/);
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

test('a financial value present only on the wrong page of the same document is not verified', () => {
  const evidence =
    'SOURCE: Annual Report 2025 | https://example.com/a.pdf\n' +
    '--- PDF PAGE 10 ---\nUnrelated prose only\n' +
    '--- PDF PAGE 66 ---\nNet Sales 401.18\n';
  const documents = [{ title: 'Annual Report 2025', url: 'https://example.com/a.pdf' }];
  const wrongPageText = citedPageText(evidence, 'Annual Report 2025', '10', documents);
  assert.equal(financialValueSupported(wrongPageText ?? '', FINANCIAL_VALUE_LABELS.revenue, 401.18), false);
  const rightPageText = citedPageText(evidence, 'Annual Report 2025', '66', documents);
  assert.equal(financialValueSupported(rightPageText ?? '', FINANCIAL_VALUE_LABELS.revenue, 401.18), true);
});

test('a financial value present only in a different document is not verified even if the page number matches', () => {
  const evidence =
    'SOURCE: Annual Report 2025 | https://example.com/a.pdf\n--- PDF PAGE 66 ---\nNo revenue figure here.\n\n' +
    'SOURCE: Annual Report 2024 | https://example.com/b.pdf\n--- PDF PAGE 66 ---\nNet Sales 401.18\n';
  const documents = [
    { title: 'Annual Report 2025', url: 'https://example.com/a.pdf' },
    { title: 'Annual Report 2024', url: 'https://example.com/b.pdf' },
  ];
  const scopedToWrongDoc = citedPageText(evidence, 'Annual Report 2025', '66', documents);
  assert.equal(financialValueSupported(scopedToWrongDoc ?? '', FINANCIAL_VALUE_LABELS.revenue, 401.18), false);
});

test('describeNullFinancialFields labels debt/ocf as not applicable for a bank instead of a verification gap', () => {
  const financials = [{ year: 2025, equity: null, dividend: 5, ocf: null, debt: null }];
  const bankGaps = describeNullFinancialFields(financials, 'Bank');
  assert.ok(bankGaps.some((g) => g.includes('2025 equity')));
  assert.ok(!bankGaps.some((g) => g.includes('2025 debt')));
  assert.ok(!bankGaps.some((g) => g.includes('2025 ocf')));
  const industrialGaps = describeNullFinancialFields(financials, 'Cement');
  assert.ok(industrialGaps.some((g) => g.includes('2025 debt')));
  assert.ok(industrialGaps.some((g) => g.includes('2025 ocf')));
});
