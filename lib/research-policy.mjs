export const RESEARCH_BUDGET_MICROS = 500_000;
export const SCORE_LIMITS = [20, 20, 15, 10, 10, 15, 10];

export function researchReserveMicros(inputCharacters, maxOutputTokens) {
  const estimatedInputTokens = Math.ceil(inputCharacters / 4) + 6_000;
  return Math.ceil(estimatedInputTokens * 0.05 + maxOutputTokens * 0.4);
}

export function validScorecard(scores) {
  return (
    Array.isArray(scores) &&
    scores.length === SCORE_LIMITS.length &&
    scores.every(
      (score, index) =>
        score === null ||
        (Number.isFinite(score) && score >= 0 && score <= SCORE_LIMITS[index]),
    )
  );
}

export function hasPdfSignature(bytes) {
  return (
    bytes?.length >= 5 &&
    new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'
  );
}

export function validPsxTicker(value) {
  return /^[A-Z0-9]{2,12}$/.test(value);
}

export function normalizeAnnualFinancials(value) {
  if (!Array.isArray(value)) return [];
  return value.map((input) => {
    const row = { ...input };
    const monetary = ['revenue', 'profit', 'ocf', 'debt', 'equity'];
    const scaleFromThousands = monetary.some(
      (key) => typeof row[key] === 'number' && Math.abs(row[key]) > 10_000_000,
    );
    if (scaleFromThousands)
      for (const key of monetary)
        if (typeof row[key] === 'number') row[key] /= 1_000;
    return row;
  });
}

export function validateInvestmentDossier(analysis, price) {
  const financials = Array.isArray(analysis.financials) ? analysis.financials : [];
  const annualYears = new Set(financials.map((row) => row.year));
  const invalidRows = financials
    .filter((row) => row.verified !== true || !row.source || !row.page || !row.basis || typeof row.eps !== 'number' || typeof row.profit !== 'number')
    .map((row) => `${row.year || 'unknown'}:${[
      row.verified !== true ? 'unverified' : '',
      !row.source ? 'source' : '',
      !row.page ? 'page' : '',
      !row.basis ? 'basis' : '',
      typeof row.eps !== 'number' ? 'eps' : '',
      typeof row.profit !== 'number' ? 'profit' : '',
    ].filter(Boolean).join(',')}`);
  if (
    financials.length !== 5 || annualYears.size !== 5 ||
    invalidRows.length
  ) throw Error(`Five directly cited annual periods are required before an investment evaluation can be completed. Received ${financials.length} rows and ${annualYears.size} distinct years${invalidRows.length ? `; invalid rows: ${invalidRows.join('; ')}` : ''}.`);

  const scenarios = Array.isArray(analysis.scenarios) ? analysis.scenarios : [];
  if (
    !Number.isFinite(price) || price <= 0 || scenarios.length !== 3 ||
    scenarios.some((item) => !Number.isFinite(item.eps) || item.eps <= 0 || !Number.isFinite(item.multiple) || item.multiple <= 0)
  ) throw Error('Reference price and three supported valuation scenarios are required before completion.');
  const fairValues = scenarios.map((item) => item.eps * item.multiple);
  if (!(fairValues[0] <= fairValues[1] && fairValues[1] <= fairValues[2]))
    throw Error('Bear, base and bull valuations must be ordered conservatively.');

  if (!validScorecard(analysis.scores)) throw Error('The generated scorecard did not pass validation.');
  if (analysis.scores.every((score, index) => score === SCORE_LIMITS[index]))
    throw Error('A perfect automatic score is not accepted as a credible evaluation.');
  const notes = Array.isArray(analysis.scoreNotes) ? analysis.scoreNotes : [];
  if (notes.length !== 7 || notes.some((note) => String(note).trim().length < 80))
    throw Error('Every score needs a substantive evidence-based explanation.');
}
