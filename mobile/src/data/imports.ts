// Broker / CDC file imports. Parsing and matching live in the shared lib (same code as the web);
// this wraps them into "portfolio in, portfolio + message out" so a screen can validate and save.
import { importAhlTrades, parseAhlHistory } from '../../../lib/ahl-import.ts';
import { importCdcDividends } from '../../../lib/cdc-import.ts';
import { addNotifications, dividendNotifications } from '../../../lib/notifications.ts';
import { supersedeAutoWithImports, type AppNotification, type Portfolio } from '../../../lib/portfolio.ts';
import { clonePortfolio, newId } from './mutations.ts';

export type ImportKind = 'ahl' | 'cdc';
/** `next` is null when there was nothing to import; `message` always explains what happened. */
export type ImportOutcome = { next: Portfolio | null; message: string };

/** One new ledger line an import would add, as shown in the preview. */
export type ImportRow = { id: string; date: string; ticker: string; label: string; detail: string };
export type ImportPreview = {
  kind: ImportKind;
  next: Portfolio | null;
  message: string;
  /** Counts come from comparing `next` with the current portfolio, so they equal exactly what is saved. */
  counts: { trades: number; dividends: number; voided: number; companies: number };
  rows: ImportRow[];
};

const num = (n: number) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(n);

/** What an import adds to or changes in the portfolio, measured from the two versions themselves. */
export function diffImport(before: Portfolio, after: Portfolio): Pick<ImportPreview, 'counts' | 'rows'> {
  const oldTrades = new Set(before.trades.map((t) => t.id));
  const oldDividends = new Set((before.dividends ?? []).map((d) => d.id));
  const oldCompanies = new Set(before.companies.map((c) => c.ticker));
  const oldVoided = new Set([...before.trades, ...(before.dividends ?? [])].filter((e) => e.voided).map((e) => e.id));
  const rows: ImportRow[] = [];
  for (const t of after.trades) {
    if (oldTrades.has(t.id)) continue;
    rows.push({
      id: t.id,
      date: t.date,
      ticker: t.ticker,
      label: `${t.kind === 'sell' ? 'Sell' : t.kind === 'opening' ? 'Opening' : 'Buy'} ${num(t.shares)}`,
      detail: `${t.price === null ? 'price unknown' : `@ ${num(t.price)}`}${t.fees ? ` · fees ${num(t.fees)}` : ''}`,
    });
  }
  const tradeCount = rows.length;
  for (const d of after.dividends ?? []) {
    if (oldDividends.has(d.id)) continue;
    rows.push({
      id: d.id,
      date: d.paymentDate ?? d.date,
      ticker: d.ticker,
      label: 'Dividend',
      detail: d.netAmount != null ? `net ${num(d.netAmount)}` : d.grossAmount != null ? `gross ${num(d.grossAmount)}` : '',
    });
  }
  const voided = [...after.trades, ...(after.dividends ?? [])].filter((e) => e.voided && !oldVoided.has(e.id)).length;
  const companies = after.companies.filter((c) => !oldCompanies.has(c.ticker)).length;
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  return { counts: { trades: tradeCount, dividends: rows.length - tradeCount, voided, companies }, rows };
}

/** Parses nothing and saves nothing: runs the import on a copy and reports what it would do. */
export function previewImport(kind: ImportKind, p: Portfolio, raw: unknown): ImportPreview {
  const outcome = kind === 'ahl' ? applyAhlImport(p, raw) : applyCdcImport(p, raw);
  const diff = outcome.next ? diffImport(p, outcome.next) : { counts: { trades: 0, dividends: 0, voided: 0, companies: 0 }, rows: [] };
  return { kind, next: outcome.next, message: outcome.message, ...diff };
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function parseJsonFile(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON. Choose the export from your broker or CDC.');
  }
}

export function applyAhlImport(p: Portfolio, raw: unknown): ImportOutcome {
  const result = importAhlTrades(p, parseAhlHistory(raw), newId);
  const skipped = `Skipped: ${result.skippedDuplicate} already imported, ${result.skippedManualMatch} matching manual entries.`;
  if (!result.imported) return { next: null, message: `No AHL trades imported. ${skipped}` };
  const next = clonePortfolio(p);
  next.companies = result.companies;
  for (const trade of next.trades) if (result.voidedTradeIds.includes(trade.id)) trade.voided = true;
  next.trades = [...next.trades, ...result.trades];
  const reconciled = result.voidedTradeIds.length
    ? ` Reconciled ${plural(result.voidedTradeIds.length, 'duplicate opening balance')}.`
    : '';
  const added = result.addedCompanies ? ` Added ${plural(result.addedCompanies, 'unapproved company', 'unapproved companies')}.` : '';
  return { next, message: `${plural(result.imported, 'AHL trade')} imported. ${skipped}${reconciled}${added}` };
}

export function applyCdcImport(p: Portfolio, raw: unknown, now: string = new Date().toISOString()): ImportOutcome {
  const result = importCdcDividends(raw, p.companies, p.dividends ?? [], newId);
  const skipped = `Skipped: ${result.skippedNotPaid} not paid, ${result.skippedDuplicate} duplicate, ${result.skippedUnknownTicker} unknown ticker, ${result.skippedInvalid} invalid.`;
  if (!result.imported) return { next: null, message: `No dividends imported. ${skipped}` };
  const next = clonePortfolio(p);
  const { voided: replaced, ambiguous } = supersedeAutoWithImports(next, next.dividends ?? [], result.dividends);
  if (ambiguous.length)
    throw new Error(
      `Nothing was imported: ${ambiguous.map((d) => `${d.ticker} ${d.date}`).join(', ')} could belong to more than one expected PSX dividend. Void the one that does not apply on the Activity tab, then import again.`,
    );
  addNotifications(next, [
    ...dividendNotifications(result.dividends, now),
    ...replaced.map(
      (d): AppNotification => ({
        id: `replaced:${d.id}`,
        at: now,
        kind: 'dividend-replaced',
        ticker: d.ticker,
        title: `${d.ticker} PSX estimate replaced`,
        body: `The PSX-announced dividend for ${d.date} was replaced by the actual CDC payment.`,
        read: false,
      }),
    ),
  ]);
  next.dividends = [...(next.dividends ?? []), ...result.dividends];
  const replacing = replaced.length ? `, replacing ${plural(replaced.length, 'PSX auto record')}` : '';
  return { next, message: `${plural(result.imported, 'dividend')} imported${replacing}. ${skipped}` };
}
