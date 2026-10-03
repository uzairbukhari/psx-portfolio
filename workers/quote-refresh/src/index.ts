import { staleHeldTickers } from '../../../lib/quote-jobs';
import { requestRefresh } from '../../../lib/workflow-requests';

// This Worker is deliberately bound only to the public database (DB). It has no VAULT_DB binding and no way to
// learn what any user holds: it refreshes tickers that are already in the shared public quote cache.
interface Env {
  DB: D1Database;
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPO?: string;
  APP_ENV?: string;
}

const tickerOK = (value: string) => /^[A-Z0-9]{2,12}$/.test(value);

/**
 * PSX refuses Cloudflare's network, so this Worker no longer fetches prices. It only queues the cached
 * tickers (the public set clients have asked for) whose shared cache has gone stale as `quotes` requests; the GitHub Actions scraper (which
 * also runs on its own schedule) serves them. Without dispatch configuration it does nothing.
 */
async function queueStaleQuotes(env: Env) {
  // The public quote cache is the source of truth for which tickers matter; no portfolio is read.
  const rows = await env.DB.prepare('SELECT ticker FROM quote_refreshes ORDER BY ticker LIMIT 500').all<{ ticker: string | null }>();
  const tickers = [...new Set(rows.results.map((row) => (row.ticker ?? '').toUpperCase()).filter(tickerOK))].sort();
  const stale = await staleHeldTickers(env.DB, tickers);
  if (!stale.length) return console.log(`PSX quote refresh: all ${tickers.length} cached quotes are current.`);
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
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // The GitHub Actions scraper is the only writer of quote_refreshes and market_summary_refreshes
    // (PSX refuses Cloudflare), so this just asks it to catch up when cached quotes have gone stale.
    ctx.waitUntil(queueStaleQuotes(env).catch((error) => console.error('Queueing stale quotes failed', error)));
  },
} satisfies ExportedHandler<Env>;
