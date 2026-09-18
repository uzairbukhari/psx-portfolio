import { fetchPsxQuote } from '../../../lib/psx-quotes';
import {
  fetchPsxIndexSummary,
  fetchPsxTopMovers,
  fetchPsxIndexSeries,
  fetchPsxSectorPerformance,
} from '../../../lib/psx-market';
import type { Portfolio } from '../../../lib/portfolio';

interface Env {
  DB: D1Database;
}

const CONCURRENCY = 5;
const MAX_TICKERS = 200;
const tickerOK = (value: string) => /^[A-Z0-9]{2,12}$/.test(value);

async function refreshQuotes(env: Env) {
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

  let fetched = 0;
  const failures: string[] = [];
  const now = new Date().toISOString();

  for (let index = 0; index < tickers.length; index += CONCURRENCY) {
    await Promise.all(
      tickers.slice(index, index + CONCURRENCY).map(async (ticker) => {
        try {
          const quote = await fetchPsxQuote(ticker);
          await env.DB.prepare(
            `INSERT INTO quote_refreshes (ticker,price,as_of,quote_date,source,fetched_at,updated_at)
             VALUES (?,?,?,?,?,?,?)
             ON CONFLICT(ticker) DO UPDATE SET
               price=excluded.price, as_of=excluded.as_of, quote_date=excluded.quote_date,
               source=excluded.source, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
          )
            .bind(
              ticker,
              quote.price,
              quote.asOf,
              quote.date,
              quote.source,
              quote.fetchedAt,
              now,
            )
            .run();
          fetched++;
        } catch (error) {
          failures.push(
            `${ticker}: ${error instanceof Error ? error.message : 'unknown failure'}`,
          );
        }
      }),
    );
  }

  console.log(
    `PSX quote refresh: ${fetched}/${tickers.length} tickers updated.` +
      (failures.length ? ` Failures: ${failures.join('; ')}` : ''),
  );
}

async function refreshMarketSummary(env: Env) {
  const [index, movers, series, sectors] = await Promise.all([
    fetchPsxIndexSummary('KSE100'),
    fetchPsxTopMovers(),
    fetchPsxIndexSeries('KSE100'),
    fetchPsxSectorPerformance(),
  ]);
  const payload = JSON.stringify({ index, movers, series, sectors });
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
    ctx.waitUntil(refreshQuotes(env));
    ctx.waitUntil(
      refreshMarketSummary(env).catch((error) =>
        console.log(`PSX market summary refresh failed: ${error instanceof Error ? error.message : error}`),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
