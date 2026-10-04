// The "watch list" behind the market pulse and live stream: which companies to show, and how a client folds its own
// private data (names, saved/manual quotes) into the public market answer. The server only ever sees the tickers.
import type { Portfolio, Quote } from './portfolio.ts';
import { isValidQuote, quoteSupersedes } from './portfolio.ts';
import type { ShortlistPerformance } from './psx-market.ts';

export const MAX_WATCH_TICKERS = 25;
/** AI Lab covers every company in the portfolio, not just the 25 the market pulse follows (D1 allows ~100 bound values). */
export const AI_LAB_MAX_TICKERS = 80;
const TICKER = /^[A-Z0-9]{2,12}$/;

/** Tickers the pulse follows: the saved Monthly Picks shortlist, else every company with a target. */
export function watchTickers(portfolio: Portfolio): string[] {
  const list = portfolio.monthlyPicksShortlist?.length
    ? portfolio.monthlyPicksShortlist
    : portfolio.companies.filter((company) => company.target > 0).map((company) => company.ticker);
  return [...new Set(list)].slice(0, MAX_WATCH_TICKERS);
}

/** Server side: a distinct, well-formed, capped list from `?tickers=A,B`. */
export function cleanWatchTickers(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
  return [...new Set(raw.map((t) => String(t).trim().toUpperCase()).filter((t) => TICKER.test(t)))].slice(0, MAX_WATCH_TICKERS);
}

/** `?tickers=` query for a watch list ('' when empty). */
export const watchQuery = (tickers: string[]) => (tickers.length ? `tickers=${encodeURIComponent(tickers.join(','))}` : '');

/**
 * Applies the client's private data to the server's public rows: company names from the portfolio, and a saved
 * (for example manually entered) quote that is newer than the cached one replaces the cached price.
 */
export function applyLocalWatch(
  companies: ShortlistPerformance[],
  names: Record<string, string>,
  saved: Portfolio['quotes'] = {},
  serverQuotes: Record<string, Quote> = {},
): ShortlistPerformance[] {
  return companies.map((company) => {
    const named = { ...company, name: names[company.ticker] ?? company.name };
    const own = saved[company.ticker];
    if (!own || !isValidQuote(own)) return named;
    const theirs = serverQuotes[company.ticker];
    if (theirs && !quoteSupersedes(own, theirs)) return named;
    // The saved quote is the freshest observation we have: show it, and drop a day change it cannot vouch for.
    const change = company.previousClose === null ? null : own.price - company.previousClose;
    return {
      ...named,
      price: own.price,
      change,
      changePercent: change !== null && company.previousClose ? (change / company.previousClose) * 100 : null,
      sourceTimestamp: own.asOf,
      retrievedAt: own.fetchedAt ?? company.retrievedAt,
    };
  });
}
