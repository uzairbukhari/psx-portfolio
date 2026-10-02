// One conditional upsert for `quote_refreshes`, shared by the Worker (lib/quote-cache.ts) and the
// GitHub Actions scraper. A late response must never replace a newer observation: a row is
// overwritten only by a later trading day, or by the same day fetched no earlier than what is stored.
// (`as_of` is PSX display text, so the trading day and fetch time are the comparable orderings.)
export const QUOTE_COLUMNS_PER_ROW = 7;

export function quoteUpsertSql(rows: number): string {
  return `INSERT INTO quote_refreshes (ticker,price,as_of,quote_date,source,fetched_at,updated_at)
           VALUES ${Array.from({ length: rows }, () => '(?,?,?,?,?,?,?)').join(',')}
           ON CONFLICT(ticker) DO UPDATE SET
             price=excluded.price, as_of=excluded.as_of, quote_date=excluded.quote_date,
             source=excluded.source, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at
           WHERE excluded.quote_date > quote_refreshes.quote_date
              OR (excluded.quote_date = quote_refreshes.quote_date AND excluded.fetched_at >= quote_refreshes.fetched_at)`;
}
