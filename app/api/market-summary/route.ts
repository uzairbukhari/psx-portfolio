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
import { db, failure, identity } from '@/lib/server';
import { fetchPypsxIntradayFor, pypsxCredentialsFor } from '@/lib/pypsx-server';

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

async function personalized(user: string, cache: MarketSummaryCache, fetchedAt: string | null) {
  const [portfolioRow, quoteRows] = await Promise.all([
    db()
      .prepare('SELECT payload FROM portfolios WHERE user_id=?')
      .bind(user)
      .first<{ payload: string }>(),
    db().prepare('SELECT ticker,price,as_of,fetched_at FROM quote_refreshes').all<{
      ticker: string;
      price: number;
      as_of: string;
      fetched_at: string;
    }>(),
  ]);
  const portfolio: Portfolio = portfolioRow
    ? JSON.parse(portfolioRow.payload)
    : blankPortfolio();
  const shortlist = portfolio.monthlyPicksShortlist?.length
    ? portfolio.monthlyPicksShortlist
    : portfolio.companies
        .filter((company) => company.target > 0)
        .map((company) => company.ticker);
  const fallback = Object.fromEntries(
    Object.entries(portfolio.quotes).map(([ticker, quote]) => [
      ticker,
      { price: quote.price, asOf: quote.asOf, fetchedAt: quote.fetchedAt },
    ]),
  );
  for (const quote of quoteRows.results)
    fallback[quote.ticker] = {
      price: quote.price,
      asOf: quote.as_of,
      fetchedAt: quote.fetched_at,
    };
  const intraday = await fetchPypsxIntradayFor(user, shortlist);
  const companies = selectShortlistPerformance(
    shortlist,
    portfolio.companies,
    cache.quotes ?? [],
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
  return {
    summary: {
      index: cache.index ?? null,
      series: cache.series ?? [],
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
    if (!market.isOpen && !force)
      return Response.json(
        { ...(await personalized(user, previous.cache, previous.fetchedAt)), skipped: market.label },
        { headers: { 'Cache-Control': 'no-store' } },
      );

    const [indexResult, seriesResult, quotesResult] = await Promise.allSettled([
      fetchPsxIndexSummary('KSE100'),
      fetchPsxIndexSeries('KSE100'),
      fetchPsxMarketWatch(),
    ]);
    const cache: MarketSummaryCache = {
      index:
        indexResult.status === 'fulfilled' ? indexResult.value : previous.cache.index,
      series:
        seriesResult.status === 'fulfilled' ? seriesResult.value : previous.cache.series,
      quotes:
        quotesResult.status === 'fulfilled' ? quotesResult.value : previous.cache.quotes,
    };
    if (
      indexResult.status === 'rejected' &&
      seriesResult.status === 'rejected' &&
      quotesResult.status === 'rejected'
    )
      throw Error('PSX market data is temporarily unavailable. Showing the last saved update.');

    const now = new Date().toISOString();
    await db()
      .prepare(
        `INSERT INTO market_summary_refreshes (id,payload,fetched_at,updated_at)
         VALUES ('latest',?,?,?)
         ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
      )
      .bind(JSON.stringify(cache), now, now)
      .run();
    return Response.json(await personalized(user, cache, now), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
