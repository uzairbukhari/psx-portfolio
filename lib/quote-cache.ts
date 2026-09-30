import { quoteSupersedes, type Quote } from './portfolio.ts';
import { fetchBudget, type FetchBudget } from './psx-fetch.ts';
import { pakistanMarketState } from './psx-market.ts';
import { fetchPsxQuote } from './psx-quotes.ts';

/**
 * `quote_refreshes` is the one shared, cross-user PSX quote cache. The cron
 * Worker, manual "Refresh prices", and the market pulse all read and write it,
 * so a ticker fetched for one user is reused by everyone until it goes stale.
 */
export interface QuoteRow {
  ticker: string;
  price: number;
  as_of: string;
  quote_date: string;
  source: string;
  fetched_at: string;
}

/**
 * While PSX is trading, a cached quote older than this is refetched. The
 * GitHub Actions scraper (scripts/psx-quote-scrape.mjs) refreshes the cache
 * every few minutes, so Workers only fetch PSX themselves when it falls behind.
 */
export const OPEN_TTL_MS = 10 * 60_000;
/** PSX answers these when it is refusing Cloudflare's network; stop trying for this call. */
const BLOCKED = /^(403|52\d) from PSX/;
/** PSX publishes closing prices a few minutes after the bell. */
const CLOSE_GRACE_MIN = 10;
const PKT_OFFSET_MS = 5 * 60 * 60_000; // Asia/Karachi is UTC+5, no DST.
const CONCURRENCY = 3;
const MAX_JITTER_MS = 150;

export const rowToQuote = (row: QuoteRow): Quote => ({
  price: row.price,
  asOf: row.as_of,
  date: row.quote_date,
  source: row.source,
  fetchedAt: row.fetched_at,
});

/** Most recent regular-session close (plus grace) at or before `now`, ignoring holidays. */
export function lastSessionClose(now: Date): Date {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const midnight = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate());
  for (let back = 0; back < 8; back++) {
    const dayStart = midnight - back * 86_400_000;
    const weekday = new Date(dayStart).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const closeMin = (weekday === 5 ? 16 * 60 + 30 : 15 * 60 + 30) + CLOSE_GRACE_MIN;
    const close = dayStart + closeMin * 60_000 - PKT_OFFSET_MS;
    if (close <= now.getTime()) return new Date(close);
  }
  return new Date(0);
}

/**
 * Open market: fresh for OPEN_TTL_MS. Closed market: fresh once fetched after
 * the last session's close — nothing changes until the next open, so no PSX
 * call is spent outside trading hours.
 */
export function isFresh(fetchedAt: string | undefined, now = new Date()): boolean {
  const fetched = Date.parse(fetchedAt ?? '');
  if (!Number.isFinite(fetched)) return false;
  if (pakistanMarketState(now).isOpen) return now.getTime() - fetched < OPEN_TTL_MS;
  return fetched >= lastSessionClose(now).getTime();
}

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
    if (quoteSupersedes(cached, merged[row.ticker])) merged[row.ticker] = cached;
  }
  return merged;
}

/**
 * Keeps the market-summary quotes (with day change) unless the per-ticker
 * cache holds a strictly newer price. The scraper writes both tables in one
 * run with the same timestamp, so a tie must keep the summary quote.
 */
export function currentWatchQuotes<T extends { symbol: string; retrievedAt: string }>(
  watch: T[],
  quotes: Record<string, Quote>,
): T[] {
  return watch.filter((entry) => {
    const cached = quotes[entry.symbol];
    return !cached || entry.retrievedAt >= cached.fetchedAt;
  });
}

/**
 * Like currentWatchQuotes, but a summary quote that the per-ticker cache has
 * overtaken (a newer company-page price, which carries no day change) is not
 * dropped: it is rebased onto the newer price using the same trading day's
 * previous close, so change and changePercent survive. A summary quote from a
 * different day than the cached price is dropped.
 */
export function rebaseWatchQuotes<
  T extends {
    symbol: string;
    retrievedAt: string;
    price: number;
    change: number;
    changePercent: number;
    sourceTimestamp: string | null;
  },
>(watch: T[], quotes: Record<string, Quote>): T[] {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return watch.flatMap((entry) => {
    const cached = quotes[entry.symbol];
    if (!cached || entry.retrievedAt >= cached.fetchedAt) return [entry];
    const previousClose = entry.price - entry.change;
    if (
      (entry.sourceTimestamp ?? '').slice(0, 10) !== cached.date ||
      !Number.isFinite(previousClose) ||
      !(previousClose > 0)
    )
      return [];
    const change = round2(cached.price - previousClose);
    return [
      {
        ...entry,
        price: cached.price,
        change,
        changePercent: round2((change / previousClose) * 100),
        sourceTimestamp: cached.asOf,
        retrievedAt: cached.fetchedAt,
      },
    ];
  });
}

export async function readQuoteRows(db: D1Database): Promise<QuoteRow[]> {
  const rows = await db
    .prepare('SELECT ticker,price,as_of,quote_date,source,fetched_at FROM quote_refreshes')
    .all<QuoteRow>();
  return rows.results;
}

// D1 allows 100 bound parameters per statement; 7 per row.
const ROWS_PER_STATEMENT = 14;

/** Upserts quotes in as few D1 statements as possible (one batch call). */
export async function writeQuotes(db: D1Database, quotes: Record<string, Quote>) {
  const entries = Object.entries(quotes);
  if (!entries.length) return;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < entries.length; index += ROWS_PER_STATEMENT) {
    const chunk = entries.slice(index, index + ROWS_PER_STATEMENT);
    statements.push(
      db
        .prepare(
          `INSERT INTO quote_refreshes (ticker,price,as_of,quote_date,source,fetched_at,updated_at)
           VALUES ${chunk.map(() => '(?,?,?,?,?,?,?)').join(',')}
           ON CONFLICT(ticker) DO UPDATE SET
             price=excluded.price, as_of=excluded.as_of, quote_date=excluded.quote_date,
             source=excluded.source, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
        )
        .bind(
          ...chunk.flatMap(([ticker, quote]) => [
            ticker,
            quote.price,
            quote.asOf,
            quote.date,
            quote.source,
            quote.fetchedAt,
            now,
          ]),
        ),
    );
  }
  await db.batch(statements);
}

export interface QuoteRefresh {
  /** Best available quote per ticker: freshly fetched, else cached. */
  quotes: Record<string, Quote>;
  /** Tickers fetched from PSX in this call. */
  fetched: string[];
  /** Tickers served from an out-of-date cache, with why a fetch didn't replace it. */
  stale: Record<string, string>;
  /** Tickers with no quote at all, with the failure reason. */
  failed: Record<string, string>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Returns a quote for each ticker, fetching from PSX only the ones whose cache
 * is stale (or all of them when `force`), oldest first, within `budget`.
 * Fresh results are written back to `quote_refreshes`.
 */
export async function refreshQuotes(
  db: D1Database,
  tickers: string[],
  {
    budget = fetchBudget(40),
    force = false,
    now = new Date(),
    fetchQuote = fetchPsxQuote,
  }: {
    budget?: FetchBudget;
    force?: boolean;
    now?: Date;
    fetchQuote?: (ticker: string, budget: FetchBudget) => Promise<Quote>;
  } = {},
): Promise<QuoteRefresh> {
  const cached = new Map(
    (await readQuoteRows(db)).map((row) => [row.ticker, rowToQuote(row)]),
  );
  const result: QuoteRefresh = { quotes: {}, fetched: [], stale: {}, failed: {} };
  const due: string[] = [];
  for (const ticker of tickers) {
    const quote = cached.get(ticker);
    if (quote) result.quotes[ticker] = quote;
    if (force || !quote || !isFresh(quote.fetchedAt, now)) due.push(ticker);
  }
  due.sort((a, b) =>
    (cached.get(a)?.fetchedAt ?? '').localeCompare(cached.get(b)?.fetchedAt ?? ''),
  );

  const fresh: Record<string, Quote> = {};
  const miss = (ticker: string, reason: string) => {
    if (result.quotes[ticker]) result.stale[ticker] = reason;
    else result.failed[ticker] = reason;
  };
  for (let index = 0; index < due.length; index += CONCURRENCY) {
    await Promise.all(
      due.slice(index, index + CONCURRENCY).map(async (ticker) => {
        if (budget.left <= 0) return miss(ticker, 'Refresh limit reached; try again shortly.');
        try {
          await sleep(Math.random() * MAX_JITTER_MS);
          const quote = await fetchQuote(ticker, budget);
          fresh[ticker] = quote;
          result.quotes[ticker] = quote;
          result.fetched.push(ticker);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown failure';
          if (BLOCKED.test(message)) budget.left = 0;
          miss(ticker, message.slice(0, 1000));
        }
      }),
    );
  }
  await writeQuotes(db, fresh);
  return result;
}
