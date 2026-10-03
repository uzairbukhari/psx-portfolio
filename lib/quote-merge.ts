// Pure pieces of the shared quote cache, split out so the native apps can bundle them (the D1 reader and the
// PSX fetcher stay in lib/quote-cache.ts).
import { isValidQuote, quoteSupersedes, type Quote } from './portfolio.ts';

/** One row of `quote_refreshes`, the shared cross-user PSX quote cache. */
export interface QuoteRow {
  ticker: string;
  price: number;
  as_of: string;
  quote_date: string;
  source: string;
  fetched_at: string;
}

export const rowToQuote = (row: QuoteRow): Quote => ({
  price: row.price,
  asOf: row.as_of,
  date: row.quote_date,
  source: row.source,
  fetchedAt: row.fetched_at,
});

/**
 * Overlays cached rows onto a portfolio's own quotes for the given tickers,
 * never replacing a newer saved quote (see `quoteSupersedes`).
 */
export function mergeQuotes(
  quotes: Record<string, Quote>,
  rows: QuoteRow[],
  tickers: Iterable<string>,
): Record<string, Quote> {
  const wanted = new Set(tickers);
  const merged = { ...quotes };
  for (const row of rows) {
    if (!wanted.has(row.ticker)) continue;
    const cached = rowToQuote(row);
    // A malformed cache row must never reach a portfolio, where it would fail every save.
    if (isValidQuote(cached) && quoteSupersedes(cached, merged[row.ticker]))
      merged[row.ticker] = cached;
  }
  return merged;
}
