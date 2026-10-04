// Works out which import a chosen file belongs to, so one upload box can open the right review.
export type ImportKind = 'ahl' | 'finqalab' | 'cdc' | 'ipo';

export const IMPORT_LABEL: Record<ImportKind, string> = {
  ahl: 'AHL trades',
  finqalab: 'Finqalab trades',
  cdc: 'CDC dividends',
  ipo: 'IPO allotments',
};
export const UNSUPPORTED_FILE =
  'That file is not one of the supported imports: an AHL Client Ledger (PDF) or trade history (JSON), a Finqalab Periodic Trade Details Report (PDF), a CDC dividend export (JSON) or an IPO list (JSON).';

/** PDFs: a Finqalab report is recognised by its title; any other PDF goes to the AHL parser, which validates it. */
export function detectPdfImport(text: string): 'finqalab' | 'ahl' {
  return /Periodic\s+Trade\s+Details\s+Report\s+By\s+Finqalab/i.test(text) ? 'finqalab' : 'ahl';
}

/** JSON: by the fields of the first row. Returns null when nothing matches. */
export function detectJsonImport(raw: unknown): ImportKind | null {
  const wrapped = raw as { data?: unknown } | null;
  const rows = Array.isArray(raw) ? raw : Array.isArray(wrapped?.data) ? (wrapped!.data as unknown[]) : null;
  const first = rows?.find((row) => row && typeof row === 'object') as Record<string, unknown> | undefined;
  if (!first) return null;
  if ('subscriptionAppId' in first || ('securitySymbol' in first && 'noOfSecuritiesSuccessful' in first)) return 'ipo';
  if ('dividendStatus' in first || 'grossDividendAmount' in first) return 'cdc';
  if ('scrip' in first && 'grossRate' in first) return 'ahl';
  return null;
}

export type ImportSummary = Record<ImportKind, { count: number; latest: string } | null>;

/** What each import has already brought into the ledger (counts and latest date), from the user's own portfolio. */
export function summarizeImports(p: {
  trades: readonly { source?: string; voided?: boolean; date: string }[];
  dividends?: readonly { source: string; voided?: boolean; date: string }[];
}): ImportSummary {
  const pick = (rows: readonly { voided?: boolean; date: string }[]) =>
    rows.length ? { count: rows.length, latest: rows.reduce((a, r) => (r.date > a ? r.date : a), '') } : null;
  const trades = (source: string) => pick(p.trades.filter((t) => !t.voided && t.source === source));
  return {
    ahl: trades('ahl'),
    finqalab: trades('finqalab'),
    ipo: trades('ipo'),
    cdc: pick((p.dividends ?? []).filter((d) => !d.voided && d.source === 'import')),
  };
}
