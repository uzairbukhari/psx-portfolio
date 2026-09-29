import {
  fetchPsxIndexSummary,
  fetchPsxIndexSeries,
  fetchPsxMarketWatch,
} from '../../../lib/psx-market';
import { fetchBudget } from '../../../lib/psx-fetch';
import { refreshQuotes } from '../../../lib/quote-cache';
import type { Portfolio } from '../../../lib/portfolio';

interface Env {
  DB: D1Database;
}

const MAX_TICKERS = 200;
// Workers cap subrequests per invocation (50 on the free plan). Each run
// refreshes at most this many PSX fetches, stalest tickers first, so large
// ticker sets rotate across the 15-minute runs instead of failing.
const PSX_BUDGET = 40;
const tickerOK = (value: string) => /^[A-Z0-9]{2,12}$/.test(value);

async function refreshAllQuotes(env: Env) {
  const rows = await env.DB.prepare('SELECT payload FROM portfolios').all<{
    payload: string;
  }>();

  const tickers = [
    ...new Set(
      rows.results.flatMap((row) => {
        try {
          const portfolio = JSON.parse(row.payload) as Portfolio;
          return portfolio.companies.map((c) => c.ticker.toUpperCase());
        } catch {
          return [];
        }
      }),
    ),
  ]
    .filter(tickerOK)
    .slice(0, MAX_TICKERS);

  const { fetched, stale, failed } = await refreshQuotes(env.DB, tickers, {
    budget: fetchBudget(PSX_BUDGET),
  });
  const failures = Object.entries({ ...stale, ...failed });
  console.log(
    `PSX quote refresh: ${fetched.length} fetched, ${tickers.length - fetched.length - failures.length} still fresh, ${failures.length} not refreshed.` +
      (failures.length
        ? ` ${failures.map(([ticker, reason]) => `${ticker}: ${reason}`).join('; ')}`
        : ''),
  );
}

async function refreshMarketSummary(env: Env) {
  // One PSX call each; /timeseries/int and /market-watch currently 404, so keep
  // whatever pieces succeed instead of dropping the whole summary.
  const budget = fetchBudget(5);
  const [indexResult, seriesResult, quotesResult] = await Promise.allSettled([
    fetchPsxIndexSummary('KSE100', budget),
    fetchPsxIndexSeries('KSE100', 60, budget),
    fetchPsxMarketWatch(budget),
  ]);
  if (indexResult.status === 'rejected') throw indexResult.reason;
  const index = indexResult.value;
  const previous = await env.DB.prepare(
    "SELECT payload FROM market_summary_refreshes WHERE id='latest'",
  ).first<{ payload: string }>();
  let previousSeries: unknown;
  try {
    previousSeries = previous ? JSON.parse(previous.payload).series : undefined;
  } catch {
    previousSeries = undefined;
  }
  const payload = JSON.stringify({
    index,
    series: seriesResult.status === 'fulfilled' ? seriesResult.value : previousSeries,
    quotes: quotesResult.status === 'fulfilled' ? quotesResult.value : undefined,
  });
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO market_summary_refreshes (id,payload,fetched_at,updated_at)
     VALUES ('latest',?,?,?)
     ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
  )
    .bind(payload, index.fetchedAt, now)
    .run();
  console.log('PSX market summary refreshed.');
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshAllQuotes(env));
    ctx.waitUntil(
      refreshMarketSummary(env).catch((error) =>
        console.log(`PSX market summary refresh failed: ${error instanceof Error ? error.message : error}`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
