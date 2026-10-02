import { fetchBudget } from '../../../lib/psx-fetch';
import { refreshQuotes } from '../../../lib/quote-cache';
import { processDueRuns } from '../../../lib/recommendation-service';

interface Env {
  DB: D1Database;
  OPENAI_API_KEY?: string;
  AI_MONTHLY_CAP_USD?: string;
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPO?: string;
  APP_ENV?: string;
}

/** The per-minute cron that advances Monthly Picks runs (see wrangler.jsonc `triggers.crons`). */
const RUN_PROCESSOR_CRON = '* * * * *';

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

  // Every held ticker is a candidate: `refreshQuotes` orders the due ones stalest first and the
  // fetch budget stops it, so tickers past the budget stay the stalest and go first next run
  // instead of an alphabetical cut-off starving the same symbols forever.
  const tickers = [...new Set(rows.results.map((row) => row.ticker ?? '').filter(tickerOK))].sort();

  const { fetched, stale, failed } = await refreshQuotes(env.DB, tickers, {
    budget: fetchBudget(PSX_BUDGET),
  });
  const failures = Object.entries({ ...stale, ...failed });
  const deferred = failures.filter(([, reason]) => /Refresh limit reached/.test(reason)).length;
  console.log(
    `PSX quote refresh: ${fetched.length} fetched, ${tickers.length - fetched.length - failures.length} still fresh, ${failures.length} not refreshed (${deferred} deferred to the next run by the fetch budget).` +
      (failures.length
        ? ` ${failures.map(([ticker, reason]) => `${ticker}: ${reason}`).join('; ')}`
        : ''),
  );
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === RUN_PROCESSOR_CRON) {
      // Runs finish without any open client: claim due runs, advance each one step under a lease.
      ctx.waitUntil(
        processDueRuns({
          db: env.DB,
          openaiKey: env.OPENAI_API_KEY,
          aiCapUsd: env.AI_MONTHLY_CAP_USD,
          dispatch: { token: env.GITHUB_DISPATCH_TOKEN, repo: env.GITHUB_REPO, appEnv: env.APP_ENV },
        }).catch((error) => console.error('Monthly Picks processor failed', error)),
      );
      return;
    }
    // Fallback only: the GitHub Actions scraper is the primary writer of both
    // quote_refreshes and market_summary_refreshes (PSX refuses most Cloudflare
    // requests), so this skips quotes it already has fresh and leaves the
    // market summary alone.
    ctx.waitUntil(refreshAllQuotes(env));
  },
} satisfies ExportedHandler<Env>;
