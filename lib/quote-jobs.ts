// Manual quote refresh as a durable job. PSX refuses Cloudflare egress, so the Worker never fetches a
// price itself: it serves the shared cache at once, queues the due tickers as `quotes` requests
// (`refresh_requests`, one dispatch however many users click) and reports the job's state while the
// GitHub Actions scraper (scripts/psx-quote-scrape.mjs) works through it. Everything here is pure or
// takes the D1 binding, so it is shared by the web routes, the cron Worker and the tests.
import type { Quote } from './portfolio.ts';
import { dispatchBlockedReason, type DispatchConfig } from './github-dispatch.ts';
import { isFresh, readQuoteRows, rowToQuote } from './quote-cache.ts';
import { readRequests, requestRefresh, tickerState, type RequestRow } from './workflow-requests.ts';

export { QUOTE_MESSAGES, QUOTE_NOTES } from './quote-job-types.ts';
export type { QuoteJob, QuoteJobState, QuoteOutcome } from './quote-job-types.ts';
import { QUOTE_MESSAGES, QUOTE_NOTES, type QuoteJob, type QuoteJobState, type QuoteOutcome } from './quote-job-types.ts';

const OUTCOMES = new Set<string>(['updated', 'already_current', 'fallback_used', 'failed']);
const SUCCESS = new Set<QuoteOutcome>(['updated', 'already_current', 'fallback_used']);

export const messageFor = (state: QuoteJobState): string | null =>
  state === 'idle' ? null
  : state === 'fresh' ? QUOTE_MESSAGES.fresh
  : state === 'queued' || state === 'running' ? QUOTE_MESSAGES.pending
  : state === 'completed' ? QUOTE_MESSAGES.updated
  : state === 'partial' ? QUOTE_MESSAGES.partial
  : QUOTE_MESSAGES.failed;

/**
 * Derives the job from the requests of its tickers. An old cached price is never a success on its own:
 * a ticker counts as refreshed only when the scraper verified it (`outcome`), and a request that never
 * finished within the timeout counts as failed. `since` ignores requests older than the job being polled.
 */
export function deriveQuoteJob(rows: Map<string, RequestRow>, tickers: string[], now: number, since?: string): QuoteJob {
  const covered: string[] = [];
  const outcomes: Record<string, QuoteOutcome> = {};
  const pending: string[] = [];
  let requestedAt: string | undefined;
  for (const ticker of tickers) {
    const row = rows.get(ticker);
    if (!row || (since && row.requested_at < since)) continue;
    covered.push(ticker);
    if (!requestedAt || row.requested_at < requestedAt) requestedAt = row.requested_at;
    const state = tickerState(row, ticker, now).state;
    if (state === 'queued' || state === 'running') pending.push(ticker);
    else outcomes[ticker] = state === 'completed' && OUTCOMES.has(row.outcome ?? '') ? (row.outcome as QuoteOutcome) : 'failed';
  }
  if (!covered.length) return { state: 'idle', tickers: [], outcomes, pending, message: null };
  const running = pending.some((ticker) => rows.get(ticker)?.status === 'running');
  let state: QuoteJobState;
  if (pending.length) state = running ? 'running' : 'queued';
  else {
    const results = Object.values(outcomes);
    const ok = results.filter((outcome) => SUCCESS.has(outcome)).length;
    state = ok === 0 ? 'failed' : ok < results.length ? 'partial' : results.every((outcome) => outcome === 'already_current') ? 'fresh' : 'completed';
  }
  return { state, tickers: covered, outcomes, pending, message: messageFor(state), requestedAt };
}

/** Quotes whose cache is stale (or all of them when forced); a ticker with no cached price is always due. */
export function dueTickers(cached: Map<string, Quote>, tickers: string[], force: boolean, now: Date): string[] {
  return tickers.filter((ticker) => {
    const quote = cached.get(ticker);
    return force || !quote || !isFresh(quote.fetchedAt, now);
  });
}

export interface QuoteSnapshot {
  quotes: Record<string, Quote>;
  /** Tickers whose cached price is out of date, mapped to a clean note (never a provider detail). */
  stale: Record<string, string>;
  /** Tickers with no price at all. */
  failed: Record<string, string>;
}

export async function readCachedQuotes(db: D1Database, tickers: string[]) {
  const wanted = new Set(tickers);
  return new Map((await readQuoteRows(db)).filter((row) => wanted.has(row.ticker)).map((row) => [row.ticker, rowToQuote(row)] as const));
}

/** Cached prices, with a clean note for every one that is out of date or missing. */
export function snapshotOf(cached: Map<string, Quote>, tickers: string[], due: string[]): QuoteSnapshot {
  const snapshot: QuoteSnapshot = { quotes: {}, stale: {}, failed: {} };
  for (const ticker of tickers) {
    const quote = cached.get(ticker);
    if (quote) snapshot.quotes[ticker] = quote;
    if (!due.includes(ticker)) continue;
    if (quote) snapshot.stale[ticker] = QUOTE_NOTES.retained;
    else snapshot.failed[ticker] = QUOTE_NOTES.missing;
  }
  return snapshot;
}

/**
 * Serves the cache and queues what is due. Never fetches PSX. Without dispatch configuration (or on
 * staging) the job is `unavailable` — it never reports a refresh that did not happen.
 */
export async function requestQuoteJob(
  db: D1Database,
  config: DispatchConfig,
  tickers: string[],
  { force = false, now = Date.now(), fetcher = fetch }: { force?: boolean; now?: number; fetcher?: typeof fetch } = {},
): Promise<{ snapshot: QuoteSnapshot; job: QuoteJob; due: string[] }> {
  const cached = await readCachedQuotes(db, tickers);
  const due = dueTickers(cached, tickers, force, new Date(now));
  if (!due.length) return { snapshot: snapshotOf(cached, tickers, []), due, job: { state: 'fresh', tickers: [], outcomes: {}, pending: [], message: QUOTE_MESSAGES.fresh } };
  if (dispatchBlockedReason(config)) return { snapshot: snapshotOf(cached, tickers, due), due, job: unavailable(due) };
  await requestRefresh(db, config, 'quotes', due, now, fetcher, 200);
  const derived = deriveQuoteJob(await readRequests(db, 'quotes', due), due, now);
  // The request row is the single source of truth: a dispatch GitHub refused is already marked failed.
  const job = derived.state === 'idle' ? unavailable(due) : derived;
  return { snapshot: snapshotOf(cached, tickers, unrefreshed(job, due)), due, job };
}

/** Tickers whose old price is being kept because a refresh failed. Pending ones are not failures. */
const unrefreshed = (job: QuoteJob, due: string[]) =>
  job.state === 'unavailable' ? due : job.tickers.filter((ticker) => job.outcomes[ticker] === 'failed');

export const unavailable = (tickers: string[]): QuoteJob => ({
  state: 'unavailable', tickers, outcomes: {}, pending: [], message: QUOTE_MESSAGES.failed,
});

/** Polling: the state of an earlier request, with no dispatch and no write. */
export async function quoteJobStatus(db: D1Database, tickers: string[], since: string | undefined, now = Date.now()) {
  const cached = await readCachedQuotes(db, tickers);
  const job = deriveQuoteJob(await readRequests(db, 'quotes', tickers), tickers, now, since);
  return { snapshot: snapshotOf(cached, tickers, unrefreshed(job, tickers)), job };
}

/** Stale tickers the scheduled Worker should queue: held, and not fresh in the shared cache. */
export async function staleHeldTickers(db: D1Database, tickers: string[], now = new Date()) {
  const cached = await readCachedQuotes(db, tickers);
  return dueTickers(cached, tickers, false, now);
}
