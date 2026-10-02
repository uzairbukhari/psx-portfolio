import { staleHeldTickers } from '../../../lib/quote-jobs';
import { requestRefresh } from '../../../lib/workflow-requests';
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

const tickerOK = (value: string) => /^[A-Z0-9]{2,12}$/.test(value);

/**
 * PSX refuses Cloudflare's network, so this Worker no longer fetches prices. It only queues the held
 * tickers whose shared cache has gone stale as `quotes` requests; the GitHub Actions scraper (which
 * also runs on its own schedule) serves them. Without dispatch configuration it does nothing.
 */
async function queueStaleQuotes(env: Env) {
  // Only the ticker list is needed, so let D1 extract it instead of loading every
  // portfolio payload (they can be megabytes each) into the Worker.
  const rows = await env.DB.prepare(
    `SELECT DISTINCT upper(json_extract(c.value, '$.ticker')) AS ticker
     FROM portfolios, json_each(portfolios.payload, '$.companies') AS c`,
  ).all<{ ticker: string | null }>();
  const tickers = [...new Set(rows.results.map((row) => row.ticker ?? '').filter(tickerOK))].sort();
  const stale = await staleHeldTickers(env.DB, tickers);
  if (!stale.length) return console.log(`PSX quote refresh: all ${tickers.length} held quotes are current.`);
  const result = await requestRefresh(
    env.DB,
    { token: env.GITHUB_DISPATCH_TOKEN, repo: env.GITHUB_REPO, appEnv: env.APP_ENV },
    'quotes',
    stale,
    Date.now(),
    fetch,
    200,
  );
  console.log(
    `PSX quote refresh: ${stale.length} stale, ${result.queued.length} queued, ${result.alreadyRunning.length} already in flight.` +
      (result.dispatched || !result.reason ? '' : ` Not dispatched: ${result.reason}`),
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
    // The GitHub Actions scraper is the only writer of quote_refreshes and market_summary_refreshes
    // (PSX refuses Cloudflare), so this just asks it to catch up when held quotes have gone stale.
    ctx.waitUntil(queueStaleQuotes(env).catch((error) => console.error('Queueing stale quotes failed', error)));
  },
} satisfies ExportedHandler<Env>;
