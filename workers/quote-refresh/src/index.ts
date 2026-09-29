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
