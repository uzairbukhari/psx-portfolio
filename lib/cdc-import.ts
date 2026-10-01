import { dateOK, round, type Company, type Dividend } from './portfolio.ts';

function parseCdcAmount(v: unknown): number {
  return typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
}
function parseCdcPaymentDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return dateOK(iso) ? iso : null;
}
export type CdcImportSummary = {
  dividends: Dividend[];
  imported: number;
  skippedNotPaid: number;
  skippedDuplicate: number;
  skippedUnknownTicker: number;
  skippedInvalid: number;
};
export function importCdcDividends(
  raw: unknown,
  companies: Company[],
  existing: Dividend[],
  newId: () => string = () => crypto.randomUUID(),
): CdcImportSummary {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { data?: unknown } | null)?.data)
      ? (raw as { data: unknown[] }).data
      : [];
  const tickers = new Set(companies.map((c) => c.ticker));
  const seenIds = new Set(
    existing.filter((d) => !d.voided && d.externalId).map((d) => d.externalId),
  );
  const summary: CdcImportSummary = {
    dividends: [],
    imported: 0,
    skippedNotPaid: 0,
    skippedDuplicate: 0,
    skippedUnknownTicker: 0,
    skippedInvalid: 0,
  };
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    if (
      typeof r.dividendStatus !== 'string' ||
      r.dividendStatus.toUpperCase() !== 'PAID'
    ) {
      summary.skippedNotPaid++;
      continue;
    }
    const eventId = typeof r.eventId === 'string' ? r.eventId : undefined;
    if (eventId && seenIds.has(eventId)) {
      summary.skippedDuplicate++;
      continue;
    }
    const ticker =
      typeof r.securitySymbol === 'string'
        ? r.securitySymbol.toUpperCase()
        : '';
    if (!tickers.has(ticker)) {
      summary.skippedUnknownTicker++;
      continue;
    }
    const date =
      typeof r.paymentDate === 'string'
        ? parseCdcPaymentDate(r.paymentDate)
        : null;
    const gross = parseCdcAmount(r.grossDividendAmount);
    const net = parseCdcAmount(r.netDividendAmount);
    if (
      !date ||
      !Number.isFinite(gross) ||
      gross < 0 ||
      !Number.isFinite(net) ||
      net < 0 ||
      net > gross
    ) {
      summary.skippedInvalid++;
      continue;
    }
    summary.dividends.push({
      id: newId(),
      ticker,
      date,
      source: 'import',
      grossAmount: round(gross),
      netAmount: round(net),
      externalId: eventId,
      financialYear:
        typeof r.financialYear === 'string' ? r.financialYear : undefined,
      note: '',
    });
    if (eventId) seenIds.add(eventId);
    summary.imported++;
  }
  return summary;
}
