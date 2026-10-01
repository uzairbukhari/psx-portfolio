import { blankPortfolio, type Portfolio } from '@/lib/portfolio';
import {
  fetchPsxIndexSeries,
  fetchPsxIndexSummary,
  fetchPsxMarketWatch,
  pakistanMarketState,
  selectShortlistPerformance,
  type IndexPoint,
  type IndexSummary,
  type MarketWatchQuote,
} from '@/lib/psx-market';
import { fillChangeFromHistory, parseEod, pktDate, type PricePoint } from '@/lib/price-history';
import { fetchBudget, type FetchBudget } from '@/lib/psx-fetch';
import {
  mergeQuotes,
  OPEN_TTL_MS,
  readQuoteRows,
  rebaseWatchQuotes,
  refreshQuotes,
} from '@/lib/quote-cache';
import { db, failure, identity } from '@/lib/server';
import { fetchPypsxIntradayFor, pypsxCredentialsFor } from '@/lib/pypsx-server';

/**
 * A saved summary younger than this is served as-is. The GitHub Actions
 * scraper (scripts/psx-quote-scrape.mjs) rewrites it every few minutes because
 * PSX refuses most requests from Cloudflare, so the Worker only tries PSX
 * itself when the scraper has fallen behind.
 */
const MIN_REFRESH_MS = OPEN_TTL_MS;
/** PSX fetches allowed per POST — stays under the Workers subrequest cap with room for D1/pyPSX. */
const PSX_BUDGET = 35;
/** Shortlist tickers refreshed per POST and pyPSX intraday calls per request. */
const MAX_SHORTLIST_REFRESH = 30;
const MAX_INTRADAY = 10;

interface MarketSummaryCache {
  index?: IndexSummary;
  series?: IndexPoint[];
  quotes?: MarketWatchQuote[];
}

async function cachedSummary() {
  const row = await db()
    .prepare('SELECT payload, fetched_at FROM market_summary_refreshes WHERE id=?')
    .bind('latest')
    .first<{ payload: string; fetched_at: string }>();
  if (!row) return { cache: {} as MarketSummaryCache, fetchedAt: null };
  try {
    return {
      cache: JSON.parse(row.payload) as MarketSummaryCache,
      fetchedAt: row.fetched_at,
    };
  } catch {
    return { cache: {} as MarketSummaryCache, fetchedAt: null };
  }
}

async function personalized(
  user: string,
  cache: MarketSummaryCache,
  fetchedAt: string | null,
  budget?: FetchBudget,
) {
  const portfolioRow = await db()
    .prepare('SELECT payload FROM portfolios WHERE user_id=?')
    .bind(user)
    .first<{ payload: string }>();
  const portfolio: Portfolio = portfolioRow
    ? JSON.parse(portfolioRow.payload)
    : blankPortfolio();
  const shortlist = portfolio.monthlyPicksShortlist?.length
    ? portfolio.monthlyPicksShortlist
    : portfolio.companies
        .filter((company) => company.target > 0)
        .map((company) => company.ticker);
  // PSX's market-watch table (one call for every symbol) is gone, so on a live
  // refresh the shortlist is priced through the shared per-ticker quote cache.
  const refreshed =
    budget && !cache.quotes?.length
      ? (
          await refreshQuotes(db(), shortlist.slice(0, MAX_SHORTLIST_REFRESH), {
            budget,
          })
        ).quotes
      : {};
  const quotes = {
    ...mergeQuotes(portfolio.quotes, await readQuoteRows(db()), shortlist),
    ...refreshed,
  };
  const fallback = Object.fromEntries(
    Object.entries(quotes).map(([ticker, quote]) => [
      ticker,
      { price: quote.price, asOf: quote.asOf, fetchedAt: quote.fetchedAt },
    ]),
  );
  const intraday = await fetchPypsxIntradayFor(user, shortlist.slice(0, MAX_INTRADAY));
  const withIntraday = selectShortlistPerformance(
    shortlist,
    portfolio.companies,
    rebaseWatchQuotes(cache.quotes ?? [], quotes),
    fallback,
  ).map((company) => {
    const session = intraday.get(company.ticker);
    return session
      ? {
          ...company,
          price: session.price,
          change: session.change ?? company.change,
          changePercent: session.changePercent ?? company.changePercent,
          high: session.high,
          low: session.low,
          previousClose: session.previousClose ?? company.previousClose,
          sourceTimestamp: session.sourceTimestamp,
          retrievedAt: new Date().toISOString(),
          intraday: session.points,
        }
      : company;
  });
  // Quotes with a price but no day change (the scraped summary can be a day old) fall back
  // to the previous close from the shared daily price history, read in one query.
  const needsChange = withIntraday
    .filter((company) => company.price !== null && company.change === null)
    .map((company) => company.ticker);
  const eod: Record<string, PricePoint[]> = {};
  if (needsChange.length) {
    const rows = await db()
      .prepare(
        `SELECT ticker, eod FROM price_history WHERE ticker IN (${needsChange.map(() => '?').join(',')})`,
      )
      .bind(...needsChange)
      .all<{ ticker: string; eod: string }>()
      .catch(() => ({ results: [] as { ticker: string; eod: string }[] }));
    for (const row of rows.results)
      try {
        eod[row.ticker] = parseEod(JSON.parse(row.eod));
      } catch {}
  }
  const companies = fillChangeFromHistory(
    withIntraday,
    eod,
    Object.fromEntries(Object.entries(quotes).map(([ticker, quote]) => [ticker, quote.date])),
    pktDate(Date.now() / 1000),
  );
  // The Worker cannot reach PSX's index ticks; the history scraper stores them.
  const indexRow = await db()
    .prepare("SELECT intraday FROM price_history WHERE ticker='KSE100'")
    .first<{ intraday: string }>()
    .catch(() => null);
  const scraped: [number, number][] = indexRow ? JSON.parse(indexRow.intraday) : [];
  const series = scraped.length > 1
    ? scraped.map(([time, value]) => ({ time, value }))
    : (cache.series ?? []);
  return {
    summary: {
      index: cache.index ?? null,
      series,
      companies,
      market: pakistanMarketState(),
      source: {
        name: 'PSX Data Portal',
        url: 'https://dps.psx.com.pk/market-watch',
        delayMinutes: 5,
        mode: 'delayed' as const,
      },
      live: {
        available: Boolean(pypsxCredentialsFor(user)),
        intradayAvailable: intraday.size > 0,
        provider: 'pyPSX',
      },
    },
    fetchedAt,
  };
}

export async function GET(req: Request) {
  try {
    const user = await identity(req);
    const { cache, fetchedAt } = await cachedSummary();
    return Response.json(await personalized(user, cache, fetchedAt), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    const previous = await cachedSummary();
    const market = pakistanMarketState();
    const force = new URL(req.url).searchParams.get('force') === '1';
    const recent =
      previous.fetchedAt &&
      Date.now() - Date.parse(previous.fetchedAt) < MIN_REFRESH_MS;
    if ((!market.isOpen || recent) && !force)
      return Response.json(
        {
          ...(await personalized(user, previous.cache, previous.fetchedAt)),
          skipped: recent ? 'Up to date' : market.label,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );

    const budget = fetchBudget(PSX_BUDGET);
    // /timeseries/int and /market-watch currently 404 on PSX; a 404 is not
    // retried, so each costs one subrequest and recovers if PSX restores them.
    const [indexResult, seriesResult, quotesResult] = await Promise.allSettled([
      fetchPsxIndexSummary('KSE100', budget),
      fetchPsxIndexSeries('KSE100', 60, budget),
      fetchPsxMarketWatch(budget),
    ]);
    const cache: MarketSummaryCache = {
      index:
        indexResult.status === 'fulfilled' ? indexResult.value : previous.cache.index,
      series:
        seriesResult.status === 'fulfilled' ? seriesResult.value : previous.cache.series,
      // personalized() only lets these outrank the per-ticker cache when newer.
      quotes: quotesResult.status === 'fulfilled' ? quotesResult.value : previous.cache.quotes,
    };
    if (
      indexResult.status === 'rejected' &&
      seriesResult.status === 'rejected' &&
      quotesResult.status === 'rejected'
    )
      return Response.json(
        {
          ...(await personalized(user, previous.cache, previous.fetchedAt)),
          skipped: 'PSX unavailable; showing the last saved update',
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );

    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO market_summary_refreshes (id,payload,fetched_at,updated_at)
         VALUES ('latest',?,?,?)
         ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
      )
      .bind(JSON.stringify(cache), now, now)
      .run();
    return Response.json(await personalized(user, cache, now, budget), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
