// One conditional upsert for `quote_refreshes`, shared by the Worker (lib/quote-cache.ts) and the
// GitHub Actions scraper. A late response must never replace a newer observation. Ordering:
//   1. a later trading day wins;
//   2. on the same day, the later SOURCE time (`observed_at`, when PSX says the price was quoted) wins;
//   3. a row with an unknown source time never replaces one with a known source time;
//   4. when neither side has a source time, the later fetch wins.
import type { Quote } from './portfolio.ts';

/** Bound parameters per row. D1 allows 100 per statement, so at most 12 rows. */
export const QUOTE_COLUMNS_PER_ROW = 8;
export const QUOTE_ROWS_PER_STATEMENT = 12;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * PSX prints "Tue, Sep 29, 2026 10:53 AM" in Pakistan time (UTC+5). Returns that instant as ISO UTC,
 * or null when the text carries no time of day.
 */
export function quoteObservedAt(asOf: string): string | null {
  const match = asOf.match(/(\w+), (\w+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) ?(AM|PM)/i);
  if (!match) return null;
  const month = MONTHS.indexOf(match[2]);
  if (month < 0) return null;
  let hour = Number(match[5]) % 12;
  if (match[7].toUpperCase() === 'PM') hour += 12;
  const ms = Date.UTC(Number(match[4]), month, Number(match[3]), hour, Number(match[6])) - 5 * 3_600_000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The 8 bound values for one row, in the order `quoteUpsertSql` expects. */
export const quoteRowParams = (ticker: string, quote: Quote, updatedAt: string) => [
  ticker, quote.price, quote.asOf, quote.date, quote.source, quote.fetchedAt, updatedAt, quoteObservedAt(quote.asOf),
];

export function quoteUpsertSql(rows: number): string {
  return `INSERT INTO quote_refreshes (ticker,price,as_of,quote_date,source,fetched_at,updated_at,observed_at)
           VALUES ${Array.from({ length: rows }, () => '(?,?,?,?,?,?,?,?)').join(',')}
           ON CONFLICT(ticker) DO UPDATE SET
             price=excluded.price, as_of=excluded.as_of, quote_date=excluded.quote_date,
             source=excluded.source, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at,
             observed_at=excluded.observed_at
           WHERE excluded.quote_date > quote_refreshes.quote_date
              OR (excluded.quote_date = quote_refreshes.quote_date AND (
                   (excluded.observed_at IS NOT NULL AND (quote_refreshes.observed_at IS NULL OR excluded.observed_at >= quote_refreshes.observed_at))
                OR (excluded.observed_at IS NULL AND quote_refreshes.observed_at IS NULL AND excluded.fetched_at >= quote_refreshes.fetched_at)))`;
}

/** Records a refresh attempt (success or failure) without touching any observation. */
export function refreshStateSql(success: boolean): string {
  return success
    ? `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,last_error,failure_count) VALUES (?,?,?,?,NULL,0)
       ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at, last_error=NULL, failure_count=0`
    : `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,last_error,failure_count) VALUES (?,?,?,NULL,?,1)
       ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_error=excluded.last_error, failure_count=failure_count+1`;
}
