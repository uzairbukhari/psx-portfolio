import { fetchBudget } from '../../../lib/psx-fetch';
import { refreshQuotes } from '../../../lib/quote-cache';

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
  // Only the ticker list is needed, so let D1 extract it instead of loading every
  // portfolio payload (they can be megabytes each) into the Worker.
  const rows = await env.DB.prepare(
    `SELECT DISTINCT upper(json_extract(c.value, '$.ticker')) AS ticker
     FROM portfolios, json_each(portfolios.payload, '$.companies') AS c`,
  ).all<{ ticker: string | null }>();

  const valid = rows.results.map((row) => row.ticker ?? '').filter(tickerOK).sort();
  const tickers = valid.slice(0, MAX_TICKERS);
  if (valid.length > tickers.length)
    console.warn(
      `PSX quote refresh: ${valid.length - tickers.length} of ${valid.length} held tickers are over the ${MAX_TICKERS}-ticker cap and were not refreshed: ${valid.slice(MAX_TICKERS).join(', ')}`,
    );

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

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Fallback only: the GitHub Actions scraper is the primary writer of both
    // quote_refreshes and market_summary_refreshes (PSX refuses most Cloudflare
    // requests), so this skips quotes it already has fresh and leaves the
    // market summary alone.
    ctx.waitUntil(refreshAllQuotes(env));
  },
} satisfies ExportedHandler<Env>;
