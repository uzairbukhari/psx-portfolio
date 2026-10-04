import { type Quote } from '@/lib/portfolio';
import { cleanWatchTickers } from '@/lib/market-watch';
import {
  fetchPsxIndexSummary,
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
} from '@/lib/quote-cache';
import { db, failure, identity } from '@/lib/server';
import { takeRateLimit, waitText } from '@/lib/rate-limit';
import { UserError } from '@/lib/user-error';
import { INDEX_LABELS, SUPPORTED_INDICES, type IndexSeries, type IndexSnapshot } from '@/lib/index-snapshot';
import { dataMeta } from '@/lib/market-freshness';
import { marketBreadth } from '@/lib/market-breadth';
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
const MAX_INTRADAY = 10;
/** Day-change fallback only needs the latest few closes; D1 trims the rest so the Worker never parses years of history. */
const RECENT_CLOSES = 5;
/** Intraday index ticks kept for the chart (newest). */
const MAX_INDEX_TICKS = 400;
const FORCE_COOLDOWN = { windowMs: 60_000, max: 1 };

/** PSX prints "2026-10-02 15:11:00" in Pakistan time (UTC+5). */
const pktStampToIso = (stamp: string) => {
  const parsed = Date.parse(`${stamp.replace(' ', 'T')}+05:00`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

interface MarketSummaryCache {
  index?: IndexSummary;
  /** KSE-100, KSE-30, KMI-30 and All-Share, each with its own source time and failure state. */
  indices?: IndexSnapshot;
  indexSeries?: IndexSeries;
  series?: IndexPoint[];
  quotes?: MarketWatchQuote[];
}

/**
 * A cheap "has anything changed" fingerprint: the saved summary's time, the newest quote among the named tickers,
 * the KSE-100 tick blob's length and whether PSX is open. Reading it costs three tiny D1 lookups, so a client that
 * already holds this version gets a 304 and the Worker never builds the view.
 */
async function summaryVersion(shortlist: string[]) {
  const [summary, quote, index] = await Promise.all([
    db().prepare("SELECT fetched_at AS v FROM market_summary_refreshes WHERE id='latest'").first<{ v: string }>(),
    shortlist.length
      ? db()
          .prepare(`SELECT MAX(fetched_at) AS v FROM quote_refreshes WHERE ticker IN (${shortlist.map(() => '?').join(',')})`)
          .bind(...shortlist)
          .first<{ v: string | null }>()
      : Promise.resolve(null),
    db().prepare("SELECT length(intraday) AS v FROM price_history WHERE ticker='KSE100'").first<{ v: number | null }>(),
  ]);
  const open = pakistanMarketState().isOpen ? 'o' : 'c';
  return `W/"${[summary?.v ?? '', quote?.v ?? '', index?.v ?? '', open, shortlist.join('.')].join('|')}"`;
}

/** Browsers may reuse a GET answer this long without asking; `private` keeps the owner-only live flag out of shared caches. */
const GET_CACHE = 'private, max-age=30';

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

/**
 * The market view for the tickers the CLIENT names (`?tickers=`). The server never loads a portfolio: which
 * companies to show, their names and any newer manual quotes are applied by the client (lib/market-watch.ts).
 */
async function marketView(
  user: string,
  cache: MarketSummaryCache,
  fetchedAt: string | null,
  shortlist: string[],
  _budget?: FetchBudget,
) {
  // Priced from the shared per-ticker quote cache the scheduled scraper keeps current; Cloudflare never
  // fetches company prices itself (PSX refuses its network).
  const quotes: Record<string, Quote> = mergeQuotes({}, await readQuoteRows(db(), shortlist), shortlist);
  const fallback = Object.fromEntries(
    Object.entries(quotes).map(([ticker, quote]) => [
      ticker,
      { price: quote.price, asOf: quote.asOf, fetchedAt: quote.fetchedAt },
    ]),
  );
  const intraday = await fetchPypsxIntradayFor(user, shortlist.slice(0, MAX_INTRADAY));
  const withIntraday = selectShortlistPerformance(
    shortlist,
    [],
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
        `SELECT ticker, (SELECT json_group_array(json(value)) FROM (SELECT value FROM json_each(price_history.eod) ORDER BY json_extract(value,'$[0]') DESC LIMIT ${RECENT_CLOSES})) AS eod FROM price_history WHERE ticker IN (${needsChange.map(() => '?').join(',')})`,
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
    .prepare(
      `SELECT (SELECT json_group_array(json(value)) FROM (SELECT value FROM json_each(price_history.intraday) ORDER BY json_extract(value,'$[0]') DESC LIMIT ${MAX_INDEX_TICKS})) AS intraday FROM price_history WHERE ticker='KSE100'`,
    )
    .first<{ intraday: string }>()
    .catch(() => null);
  let scraped: [number, number][] = [];
  try {
    scraped = indexRow ? (JSON.parse(indexRow.intraday) as [number, number][]).reverse() : [];
  } catch {}
  const series = scraped.length > 1
    ? scraped.map(([time, value]) => ({ time, value }))
    : (cache.series ?? []);
  return {
    summary: {
      index: cache.index ?? null,
      indices: SUPPORTED_INDICES.flatMap((code) => {
        const stored = cache.indices?.[code];
        if (!stored) return [];
        const { summary } = stored;
        return [{
          code,
          label: INDEX_LABELS[code],
          ...summary,
          retrievedAt: stored.retrievedAt,
          // Sampled from real scrapes (one point each); gaps are never filled in.
          series: cache.indexSeries?.[code] ?? [],
          seriesKind: 'sampled' as const,
          // Source time and fetch time stay separate; a failed refresh never freshens old data.
          meta: dataMeta({
            provider: 'PSX Data Portal',
            sourceUrl: 'https://dps.psx.com.pk/',
            sourceTimestamp: pktStampToIso(summary.asOf),
            fetchedAt: stored.retrievedAt,
            lastFailure: stored.lastFailure,
          }),
        }];
      }),
      // Counts come from one scrape's All-Share table. `coverage` is that table's size, not the number of PSX companies.
      breadth: cache.quotes?.length
        ? {
            ...marketBreadth(cache.quotes),
            source: 'All-Share constituents table',
            asOf: cache.index?.asOf ?? null,
            retrievedAt: fetchedAt,
          }
        : null,
      series,
      companies,
      /** Cache quotes behind `companies`, so the client can tell whether a saved/manual quote is newer. */
      quotes,
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
    const watch = cleanWatchTickers(new URL(req.url).searchParams.get('tickers'));
    // The owner's live pyPSX intraday changes every call, so only everyone else gets conditional answers.
    const version = pypsxCredentialsFor(user) ? null : await summaryVersion(watch).catch(() => null);
    const headers: Record<string, string> = version
      ? { 'Cache-Control': GET_CACHE, ETag: version }
      : { 'Cache-Control': 'no-store' };
    if (version && req.headers.get('If-None-Match') === version) return new Response(null, { status: 304, headers });
    const { cache, fetchedAt } = await cachedSummary();
    return Response.json(await marketView(user, cache, fetchedAt, watch), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    const watch = cleanWatchTickers(new URL(req.url).searchParams.get('tickers'));
    const previous = await cachedSummary();
    const market = pakistanMarketState();
    const force = new URL(req.url).searchParams.get('force') === '1';
    const recent =
      previous.fetchedAt &&
      Date.now() - Date.parse(previous.fetchedAt) < MIN_REFRESH_MS;
    if ((!market.isOpen || recent) && !force)
      return Response.json(
        {
          ...(await marketView(user, previous.cache, previous.fetchedAt, watch)),
          skipped: recent ? 'Up to date' : market.label,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );

    if (force) {
      // A forced refresh asks PSX for the homepage; one per minute per account keeps shared provider load bounded.
      const limit = await takeRateLimit(db(), user, 'market-force', FORCE_COOLDOWN);
      if (!limit.allowed)
        throw new UserError(
          `Market refresh is limited to once a minute. Try again in ${waitText(limit.retryAfterMs)}.`,
          429,
        );
    }
    const budget = fetchBudget(PSX_BUDGET);
    // The scraper owns charts, constituents and the other indices (PSX serves no intraday series or
    // market-watch table to this Worker), so the Worker only refreshes the KSE-100 headline itself.
    const [indexResult] = await Promise.allSettled([fetchPsxIndexSummary('KSE100', budget)]);
    if (indexResult.status === 'rejected')
      return Response.json(
        {
          ...(await marketView(user, previous.cache, previous.fetchedAt, watch)),
          skipped: 'PSX unavailable; showing the last saved update',
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    // Never replace a newer observation with an older one (the scraper may have landed meanwhile).
    const stored = previous.cache.index;
    const index = stored && stored.asOf > indexResult.value.asOf ? stored : indexResult.value;
    const cache: MarketSummaryCache = { ...previous.cache, index };
    const now = new Date().toISOString();
    // Compare-and-set on the row we read: if the scraper wrote since, keep its snapshot.
    const written = previous.fetchedAt
      ? await db()
          .prepare("UPDATE market_summary_refreshes SET payload=?,fetched_at=?,updated_at=? WHERE id='latest' AND fetched_at=?")
          .bind(JSON.stringify(cache), now, now, previous.fetchedAt)
          .run()
      : await db()
          .prepare("INSERT OR IGNORE INTO market_summary_refreshes (id,payload,fetched_at,updated_at) VALUES ('latest',?,?,?)")
          .bind(JSON.stringify(cache), now, now)
          .run();
    const current = written.meta.changes ? { cache, fetchedAt: now } : await cachedSummary();
    return Response.json(await marketView(user, current.cache, current.fetchedAt, watch), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return failure(error);
  }
}
