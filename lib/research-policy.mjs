export const RESEARCH_BUDGET_MICROS = 500_000;
export const SCORE_LIMITS = [20, 20, 15, 10, 10, 15, 10];

export function researchReserveMicros(inputCharacters, maxOutputTokens) {
  const estimatedInputTokens = Math.ceil(inputCharacters * 3) + 20_000;
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

export function credibleResearchHost(host) {
  const bare = host.replace(/^www\./, '');
  return /(^|\.)(psx\.com\.pk|secp\.gov\.pk|sbp\.org\.pk|pacra\.com|jcrvis\.com\.pk|reuters\.com|dawn\.com|brecorder\.com|pakistantoday\.com\.pk|arifhabibltd\.com|akdsl\.com|topline\.com\.pk|ktrade\.pk)$/.test(
    bare,
  );
}

export function isPrivateOrLocalHost(host) {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.localhost')) return true;
  const ipv4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    return (
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return bare === '::1' || bare.startsWith('fe80:') || bare.startsWith('fc') || bare.startsWith('fd');
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

export function correctFiscalYearLabels(financials) {
  if (!Array.isArray(financials)) return financials;
  return financials.map((row) => {
    const text = [row.source, row.page, row.basis].filter(Boolean).join(' ');
    const rangeMatch = text.match(/FY\s*(\d{4})\s*[/-]\s*(\d{2})\b/i);
    if (rangeMatch) {
      const endYear = Number(rangeMatch[1].slice(0, 2) + rangeMatch[2]);
      if (Number.isFinite(endYear) && endYear === Number(rangeMatch[1]) + 1)
        return { ...row, year: endYear };
    }
    // There used to also be a fallback here that rewrote a row's year to
    // whatever bare "Annual Report YYYY" its source named, whenever that
    // year was within 2 of the row's own year. That's backwards for the
    // normal, correct citation pattern this system explicitly asks for —
    // five rows all citing the SAME single "Annual Report YYYY" multi-year
    // table (its own year is naturally within 2 of every recent row) — and
    // silently collapsed distinct, correctly-cited years onto one, e.g.
    // [2025,2024,2023,2022,2021] all citing "Annual Report 2025" became
    // [2025,2025,2025,2022,2021]. An explicit "FY 2024-25" style range (the
    // branch above) is unambiguous; a bare report year shared across rows
    // is not, so it's no longer "corrected".
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

export const FINANCIAL_VALUE_LABELS = {
  revenue: /net sales|\bsales\b|revenue|total income/i,
  profit: /profit (?:for|after)|profit after taxation|net profit/i,
  eps: /earnings per share|\beps\b/i,
  equity: /equity|shareholders.{0,3}funds?|net assets/i,
  dividend: /cash dividend per share|dividend per share/i,
};

// A caption and its value share one line in a real text table ("Net Sales
// 401.18 463.70"), but not in a chart-style annual report: pdf.js pulls a
// chart's title and each bar's data-point label out as separate text runs
// at different y-positions, so they can land 8-10 reconstructed lines
// apart even though the chart is entirely genuine and correct (verified
// against a real MARI report: "Net Sales (Rupees in billion)" captions one
// line, the matching bar value - the exact cited figure - nine lines
// below, with several other unrelated chart-label lines between them). A
// small nearby-line window isn't enough to bridge that reliably, and how
// many lines a chart's labels get fragmented across isn't predictable.
// The one boundary every real report actually respects is the page: a
// caption and its own data always live on the same PDF page. Checking the
// whole page (or the whole block for a web source, which already has no
// internal line breaks) is looser than same-line, but still means the
// value must appear near a matching label, not anywhere in the document.
export function financialValueSupported(evidence, labels, value) {
  if (!Number.isFinite(value)) return false;
  const target = Math.abs(value);
  const hasMatchingNumber = (text) => {
    const values = [...text.matchAll(/\(?-?\d[\d,]*(?:\.\d+)?\)?/g)]
      .map((match) => Math.abs(Number(match[0].replace(/[(),]/g, ''))))
      .filter(Number.isFinite);
    return values.some((candidate) =>
      [candidate, candidate / 1_000, candidate * 1_000].some(
        (scaled) => Math.abs(scaled - target) <= Math.max(0.02, target * 0.002),
      ),
    );
  };
  const blocks = String(evidence).split(/(?=--- PDF PAGE \d+ ---)/);
  return blocks.some((block) => labels.test(block) && hasMatchingNumber(block));
}

export function describeNullFinancialFields(financials) {
  if (!Array.isArray(financials)) return [];
  const nullable = ['equity', 'dividend', 'ocf', 'debt'];
  return financials.flatMap((row) =>
    nullable
      .filter((key) => row[key] === null)
      .map((key) => `${row.year} ${key}`),
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
  if (typeof newestRow?.dividend === 'number' && newestRow.dividend < 0)
    throw Error('Latest annual dividend per share cannot be negative.');
  // Checked against the newest row only, not every historical row: a bonus
  // or rights issue restates EPS for comparability but the dividend a
  // company actually declared in an older year was never restated, which
  // can make a genuine, correctly-cited historical dividend look 3-4x EPS
  // even though both figures are exactly what the audited report prints
  // (confirmed on a real case - two different models, gpt-5 and
  // gpt-5-mini, independently read the identical dividend figures from the
  // same evidence, which rules out model error). The prompt already tells
  // the model to preserve and flag such a break rather than invent an
  // adjusted series; this check now only guards the one row that matters
  // most for a current decision and can't have this historical distortion.
  if (typeof newestRow?.dividend === 'number' && newestRow.dividend > 0 && newestRow.dividend > Math.abs(newestRow.eps) * 1.5)
    throw Error('Dividend per share is implausible relative to EPS; do not substitute payout or yield percentages.');

  const scenarios = Array.isArray(analysis.scenarios) ? analysis.scenarios : [];
  if (scenarios.map(item => String(item.name).toLowerCase()).join(',') !== 'bear,base,bull')
    throw Error('Valuation cases must be labelled Bear, Base and Bull.');
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
    .filter(({ note }) => note.length < 120);
  if (notes.length !== 7 || shallowNotes.length)
    throw Error(`Every score needs a substantive evidence-based explanation of at least 120 characters. Invalid score categories: ${shallowNotes.map(({ index }) => index + 1).join(', ') || 'missing entries'}.`);
  const uncitedNotes = notes
    .map((note, index) => ({ note: String(note), index }))
    .filter(({ note }) => !/(annual report|page\s*\d|PSX|rating|Reuters|Dawn|Business Recorder)/i.test(note));
  if (uncitedNotes.length)
    throw Error(`Every score explanation must identify the evidence source used. Missing citations in score categories: ${uncitedNotes.map(({ index }) => index + 1).join(', ')}.`);
}
