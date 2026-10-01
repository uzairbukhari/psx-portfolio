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
