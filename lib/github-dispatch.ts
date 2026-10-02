// Asks GitHub Actions to scrape specific tickers now (`psx-facts.yml`), because PSX
// blocks Cloudflare egress and the Worker cannot fetch company pages itself.
// Best-effort: never throws, so a missing token or GitHub outage just means the run
// proceeds on whatever facts the daily scrape already stored.
import { DISPATCH_DEDUPE_MS } from './monthly-picks-flow.ts';

/** The Worker settings dispatching needs; passed in so the cron Worker and the web Worker share this code. */
export type DispatchConfig = { token?: string; repo?: string; appEnv?: string };

/**
 * On-demand scrapes run the production-writing workflow (`psx-facts.yml` targets the production
 * D1 database), so only the production Worker may dispatch it. Staging never does, even if a
 * token and repo are configured there.
 */
export function dispatchBlockedReason(config: DispatchConfig): string | null {
  if (config.appEnv === 'staging') return 'On-demand fetching is disabled on staging (the workflow writes to production).';
  if (!config.token || !config.repo) return 'On-demand fetching is not configured.';
  return null;
}
export const dispatchEnabled = (config: DispatchConfig) => dispatchBlockedReason(config) === null;

// `waiting` is true when a scrape for the tickers is running (started now or earlier), so a
// caller can wait for it; false when nothing will be fetched.
export type DispatchResult = { dispatched: boolean; waiting: boolean; tickers: string[]; reason?: string };

// A dispatch that never started must not look "in flight" and block retries.
async function abandon(db: D1Database, tickers: string[], requestedAt: string | null, message: string) {
  const at = new Date().toISOString();
  await db.batch(tickers.map((ticker) => requestedAt
    ? db.prepare('UPDATE facts_requests SET attempted_at=?,error=? WHERE ticker=? AND requested_at=?').bind(at, message, ticker, requestedAt)
    : db.prepare('UPDATE facts_requests SET attempted_at=?,error=? WHERE ticker=? AND attempted_at IS NULL').bind(at, message, ticker))).catch(() => {});
}

export async function requestFacts(db: D1Database, config: DispatchConfig, tickers: string[]): Promise<DispatchResult> {
  const unique = [...new Set(tickers)].filter((ticker) => /^[A-Z0-9]{2,12}$/.test(ticker));
  if (!unique.length) return { dispatched: false, waiting: false, tickers: [], reason: 'No tickers to fetch.' };
  const blocked = dispatchBlockedReason(config);
  if (blocked) return { dispatched: false, waiting: false, tickers: [], reason: blocked };
  try {
    const placeholders = unique.map(() => '?').join(',');
    const open = (await db.prepare(
      `SELECT ticker,requested_at,attempted_at FROM facts_requests WHERE ticker IN (${placeholders})`,
    ).bind(...unique).all<{ ticker: string; requested_at: string; attempted_at: string | null }>()).results;
    const inFlight = new Set(open
      .filter((row) => Date.now() - Date.parse(row.requested_at) < DISPATCH_DEDUPE_MS &&
        (!row.attempted_at || row.attempted_at < row.requested_at))
      .map((row) => row.ticker));
    const toFetch = unique.filter((ticker) => !inFlight.has(ticker));
    if (!toFetch.length) return { dispatched: false, waiting: true, tickers: [], reason: 'A fetch for these tickers is already running.' };

    const now = new Date().toISOString();
    await db.batch(toFetch.map((ticker) => db.prepare(
      `INSERT INTO facts_requests (ticker,requested_at,attempted_at,error) VALUES (?,?,NULL,NULL)
       ON CONFLICT(ticker) DO UPDATE SET requested_at=excluded.requested_at`,
    ).bind(ticker, now)));

    const response = await fetch(
      `https://api.github.com/repos/${config.repo}/actions/workflows/psx-facts.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'psx-portfolio-worker',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', inputs: { tickers: toFetch.join(',') } }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      await abandon(db, toFetch, now, `Could not start the PSX fetch (GitHub answered ${response.status}).`);
      return { dispatched: false, waiting: false, tickers: [], reason: `GitHub answered ${response.status}.` };
    }
    return { dispatched: true, waiting: true, tickers: toFetch };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Dispatch failed.';
    await abandon(db, unique, null, `Could not start the PSX fetch (${reason}).`);
    return { dispatched: false, waiting: false, tickers: [], reason };
  }
}
