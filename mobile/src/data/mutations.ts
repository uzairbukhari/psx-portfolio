// Pure ledger edits, mirroring what the web app does when you record or correct an entry:
// corrections void the old line (kept for the audit trail) and insert a new one after it.
// Callers run validate() on the result before saving.
import {
  confirmDividendReceipt,
  dividendStatus,
  round,
  today,
  sharesHeldOn,
  type AppNotification,
  type Dividend,
  type Portfolio,
  type Quote,
  type StockSplit,
  type Trade,
} from '../../../lib/portfolio.ts';
import { addNotifications, dividendNotifications } from '../../../lib/notifications.ts';

export const clonePortfolio = (p: Portfolio): Portfolio => JSON.parse(JSON.stringify(p)) as Portfolio;

let counter = 0;
export const newId = () =>
  (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID?.() ??
  `id-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function replaceOrAppend<T extends { id: string; voided?: boolean }>(list: T[], entry: T, editingId?: string) {
  if (!editingId) {
    list.push(entry);
    return;
  }
  const index = list.findIndex((item) => item.id === editingId);
  if (index < 0) throw new Error('That entry no longer exists. Reload and try again.');
  list[index].voided = true;
  list.splice(index + 1, 0, entry);
}

export function recordTrade(p: Portfolio, trade: Omit<Trade, 'id'>, editingId?: string): Portfolio {
  const next = clonePortfolio(p);
  if (!next.companies.some((c) => c.ticker === trade.ticker)) throw new Error('Choose a company you own.');
  replaceOrAppend(next.trades, { ...trade, id: newId() }, editingId);
  return next;
}

export function recordDividend(
  p: Portfolio,
  dividend: Omit<Dividend, 'id' | 'grossAmount' | 'source'>,
  editingId?: string,
  now: string = new Date().toISOString(),
): Portfolio {
  const next = clonePortfolio(p);
  if (!next.companies.some((c) => c.ticker === dividend.ticker)) throw new Error('Choose a company you own.');
  next.dividends ??= [];
  const entry: Dividend = {
    ...dividend,
    id: newId(),
    source: 'manual',
    grossAmount: round((dividend.perShare ?? 0) * sharesHeldOn(next, dividend.ticker, dividend.date)),
  };
  replaceOrAppend(next.dividends, entry, editingId);
  addNotifications(next, dividendNotifications([entry], now));
  return next;
}

export function recordSplit(p: Portfolio, split: Omit<StockSplit, 'id'>, editingId?: string): Portfolio {
  const next = clonePortfolio(p);
  if (!next.companies.some((c) => c.ticker === split.ticker)) throw new Error('Choose a company you own.');
  next.stockSplits ??= [];
  replaceOrAppend(next.stockSplits, { ...split, id: newId() }, editingId);
  return next;
}

export type EntryKind = 'trade' | 'dividend' | 'split';

/** Marks an entry voided; it stays in the ledger but no longer counts. */
export function voidEntry(p: Portfolio, kind: EntryKind, id: string): Portfolio {
  const next = clonePortfolio(p);
  const list = kind === 'trade' ? next.trades : kind === 'dividend' ? (next.dividends ?? []) : (next.stockSplits ?? []);
  const entry = (list as { id: string; voided?: boolean }[]).find((e) => e.id === id);
  if (!entry) throw new Error('That entry no longer exists. Reload and try again.');
  entry.voided = true;
  return next;
}

/** Parses a user-typed number; empty or invalid gives null. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Saves a price you typed in; it holds until PSX publishes a later trading day. */
export function setManualQuote(
  p: Portfolio,
  ticker: string,
  price: number,
  date: string,
  now: string = new Date().toISOString(),
): Portfolio {
  if (!p.companies.some((c) => c.ticker === ticker)) throw new Error('Choose a company you own.');
  if (!(price > 0)) throw new Error('Enter a price above zero.');
  if (date > today()) throw new Error('The price date cannot be in the future.');
  const next = clonePortfolio(p);
  next.quotes[ticker] = {
    price,
    date,
    asOf: `${date} · manually entered`,
    manual: true,
    source: `https://dps.psx.com.pk/company/${ticker}`,
    fetchedAt: now,
  };
  return next;
}

export const isValidSymbol = (ticker: string) => /^[A-Z0-9]{2,12}$/.test(ticker);

/** Adds a company the ledger has not seen, with the PSX-confirmed quote that proved the symbol exists. */
export function addCompany(
  p: Portfolio,
  company: { ticker: string; name: string; sector: string },
  quote: Quote,
): Portfolio {
  if (!isValidSymbol(company.ticker)) throw new Error('Enter a valid PSX symbol (2-12 letters or digits).');
  if (p.companies.some((c) => c.ticker === company.ticker)) throw new Error(`${company.ticker} is already in your portfolio.`);
  const next = clonePortfolio(p);
  next.quotes[company.ticker] = quote;
  next.companies.push({
    ticker: company.ticker,
    name: company.name.trim() || company.ticker,
    sector: company.sector,
    target: 0,
    approved: false,
    screenDate: '',
    note: '',
  });
  return next;
}

/**
 * Marks an expected PSX dividend received, optionally with the actual gross amount and tax withheld, exactly as
 * the web does (shared confirmDividendReceipt). Blank amounts keep the expected figure and the tax estimate.
 */
export function markDividendReceived(
  p: Portfolio,
  id: string,
  receipt: { paymentDate: string; grossAmount?: number | null; taxWithheld?: number | null },
): Portfolio {
  const next = clonePortfolio(p);
  const target = next.dividends?.find((d) => d.id === id);
  if (!target || target.voided) throw new Error('That dividend no longer exists. Reload and try again.');
  if (target.source !== 'auto' || dividendStatus(target) !== 'expected') throw new Error('That dividend is already received.');
  const gross = receipt.grossAmount ?? undefined;
  const tax = receipt.taxWithheld ?? undefined;
  if ((gross !== undefined && !(gross >= 0)) || (tax !== undefined && !(tax >= 0)))
    throw new Error('Enter amounts as positive numbers, or leave them blank.');
  Object.assign(target, confirmDividendReceipt(target, { paymentDate: receipt.paymentDate, grossAmount: gross, taxWithheld: tax }));
  return next;
}

/** Applies a change to the notification list (read, clear, restore, delete cleared) on a copy of the portfolio. */
export function changeNotifications(p: Portfolio, change: (list: AppNotification[]) => AppNotification[]): Portfolio {
  const next = clonePortfolio(p);
  next.notifications = change(next.notifications ?? []);
  return next;
}

export type FilerStatus = 'filer' | 'non-filer';

/** Sets the tax status Reports use to estimate tax (the same `taxProfile.filerStatus` the web writes). */
export function setFilerStatus(p: Portfolio, filerStatus: FilerStatus): Portfolio {
  const next = clonePortfolio(p);
  next.taxProfile = { filerStatus };
  return next;
}
