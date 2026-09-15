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

export function normalizeValuationScenarios(value) {
  if (!Array.isArray(value)) return [];
  const order = { bear: 0, base: 1, bull: 2 };
  return [...value].sort(
    (left, right) =>
      (order[String(left?.name).toLowerCase()] ?? 99) -
      (order[String(right?.name).toLowerCase()] ?? 99),
  );
}

export function validateInvestmentDossier(analysis, price, referenceYear = new Date().getUTCFullYear()) {
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
  const newest = Math.max(...financials.map((row) => row.year));
  const sortedYears = [...annualYears].sort((a, b) => b - a);
  if (
    newest < referenceYear - 1 ||
    sortedYears.some((year, index) => index > 0 && sortedYears[index - 1] - year !== 1)
  ) throw Error('Annual periods must be the five latest consecutive fiscal years, labelled by their ending year.');
  if (financials.some((row) =>
    (typeof row.equity === 'number' && row.equity <= Math.abs(row.profit) * 0.5) ||
    (typeof row.ocf === 'number' && typeof row.revenue === 'number' && Math.abs(row.ocf) > Math.abs(row.revenue) * 2)
  )) throw Error('Financial units are internally inconsistent; PKR billion/thousand values must be converted to PKR million.');
  const newestRow = financials.find((row) => row.year === newest);
  if (typeof newestRow?.dividend !== 'number' || newestRow.dividend < 0)
    throw Error('Latest annual dividend per share is required to calculate dividend yield.');
  if (financials.some((row) => typeof row.dividend === 'number' && row.dividend > 0 && row.dividend > Math.abs(row.eps) * 1.5))
    throw Error('Dividend per share is implausible relative to EPS; do not substitute payout or yield percentages.');

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
  const shallowNotes = notes
    .map((note, index) => ({ note: String(note).trim(), index }))
    .filter(({ note }) => note.length < 120 || (note.match(/[.!?](?:\s|$)/g) || []).length < 2);
  if (notes.length !== 7 || shallowNotes.length)
    throw Error(`Every score needs at least two substantive evidence-based sentences. Invalid score categories: ${shallowNotes.map(({ index }) => index + 1).join(', ') || 'missing entries'}.`);
  const uncitedNotes = notes
    .map((note, index) => ({ note: String(note), index }))
    .filter(({ note }) => !/(annual report|page\s*\d|PSX|rating|Reuters|Dawn|Business Recorder)/i.test(note));
  if (uncitedNotes.length)
    throw Error(`Every score explanation must identify the evidence source used. Missing citations in score categories: ${uncitedNotes.map(({ index }) => index + 1).join(', ')}.`);
}
