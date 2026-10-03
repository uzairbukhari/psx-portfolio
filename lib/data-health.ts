// Operational health of the public data pipeline for administrators: are quotes and company facts arriving, are
// on-demand scrapes settling. Counts, timestamps and sanitised scrape errors only; the server holds no private
// portfolio data (and no Monthly Picks runs), so there is none to report.
import { pakistanMarketState } from './psx-market.ts';

export type DataHealth = {
  now: string;
  lastFactsFetchedAt: string | null;
  lastQuoteFetchedAt: string | null;
  quoteLagMinutes: number | null;
  recentFactsErrors: { ticker: string; error: string; attemptedAt: string | null }[];
  marketOpen: boolean;
  /** On-demand facts scrapes requested over 15 minutes ago that never settled. */
  unsettledFactsRequests: number;
  warnings: string[];
};

export async function dataHealth(db: D1Database, nowDate = new Date()): Promise<DataHealth> {
  const one = async <T,>(sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).first<T>();
  const facts = await one<{ last: string | null }>('SELECT MAX(fetched_at) AS last FROM company_facts');
  const quote = await one<{ last: string | null }>('SELECT MAX(fetched_at) AS last FROM quote_refreshes');
  const errors = (await db.prepare('SELECT ticker,error,attempted_at FROM facts_requests WHERE error IS NOT NULL ORDER BY attempted_at DESC LIMIT 5')
    .all<{ ticker: string; error: string; attempted_at: string | null }>()).results;
  const unsettled = await one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM facts_requests WHERE (attempted_at IS NULL OR attempted_at<requested_at) AND requested_at<?',
    new Date(nowDate.getTime() - 15 * 60_000).toISOString(),
  );
  const quoteLagMinutes = quote?.last ? Math.round((nowDate.getTime() - Date.parse(quote.last)) / 60_000) : null;
  const market = pakistanMarketState(nowDate);
  const warnings: string[] = [];
  // During a session the GitHub scraper should land a quote refresh every few minutes (GitHub may delay or drop
  // scheduled runs, so a gap is worth surfacing, not assuming).
  if (market.isOpen && (quoteLagMinutes === null || quoteLagMinutes > 30))
    warnings.push(`The market is open but the newest quote is ${quoteLagMinutes === null ? 'missing' : `${quoteLagMinutes} minutes old`}. Check the PSX quotes workflow.`);
  if ((unsettled?.n ?? 0) > 0) warnings.push(`${unsettled!.n} company-data request(s) were dispatched over 15 minutes ago and never finished.`);
  if (!facts?.last) warnings.push('No company facts have ever been stored.');
  if (quoteLagMinutes !== null && quoteLagMinutes > 24 * 60 * 3) warnings.push('Quote cache has not been updated for over three days.');
  return {
    now: nowDate.toISOString(),
    lastFactsFetchedAt: facts?.last ?? null,
    lastQuoteFetchedAt: quote?.last ?? null,
    quoteLagMinutes,
    recentFactsErrors: errors.map((e) => ({ ticker: e.ticker, error: e.error.slice(0, 300), attemptedAt: e.attempted_at })),
    marketOpen: market.isOpen,
    unsettledFactsRequests: unsettled?.n ?? 0,
    warnings,
  };
}
