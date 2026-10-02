// Bookkeeping around one run of scripts/psx-quote-scrape.mjs: which open `quotes` requests it serves,
// and how it completes them. `d1(sql, params)` is the scripts/d1-rest.mjs shape, so tests can drive it
// with node:sqlite.
import type { QuoteOutcome } from './quote-job-types.ts';
import { REQUEST_TIMEOUT_MS } from './workflow-requests.ts';

export type D1Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
/** Open requests at the start of a run: ticker -> the `requested_at` this run is answering. */
export type RequestSnapshot = Map<string, string>;

export async function snapshotOpenRequests(d1: D1Query, now = Date.now()): Promise<RequestSnapshot> {
  const cutoff = new Date(now - REQUEST_TIMEOUT_MS).toISOString();
  const rows = await d1(`SELECT ticker,requested_at FROM refresh_requests WHERE kind='quotes' AND status IN ('queued','running') AND requested_at>?`, [cutoff]);
  return new Map(rows.map((row) => [String(row.ticker), String(row.requested_at)]));
}

export async function markRunning(d1: D1Query, snapshot: RequestSnapshot, now = new Date().toISOString()) {
  for (const [ticker, requestedAt] of snapshot)
    await d1(`UPDATE refresh_requests SET status='running', started_at=? WHERE kind='quotes' AND ticker=? AND requested_at=? AND status='queued'`, [now, ticker, requestedAt]);
}

/**
 * Verified per-ticker result. A ticker is `updated` only when the stored row carries this run's fetch
 * time (so the write really landed); a stored row from a newer observation is `already_current`; one
 * that came from the company-page fallback is `fallback_used`; anything unpriced is `failed`.
 */
export function computeOutcomes({
  targets, quotes, fallback, stored,
}: {
  targets: Iterable<string>;
  quotes: Record<string, { fetchedAt: string }>;
  fallback: Set<string>;
  stored: Map<string, string>;
}): Record<string, QuoteOutcome> {
  const outcomes: Record<string, QuoteOutcome> = {};
  for (const ticker of targets) {
    const quote = quotes[ticker];
    const row = stored.get(ticker);
    outcomes[ticker] = !quote || !row ? 'failed' : row === quote.fetchedAt ? (fallback.has(ticker) ? 'fallback_used' : 'updated') : 'already_current';
  }
  return outcomes;
}

export async function readStoredFetchTimes(d1: D1Query, tickers: string[]) {
  const stored = new Map<string, string>();
  for (let i = 0; i < tickers.length; i += 90) {
    const chunk = tickers.slice(i, i + 90);
    for (const row of await d1(`SELECT ticker,fetched_at FROM quote_refreshes WHERE ticker IN (${chunk.map(() => '?').join(',')})`, chunk))
      stored.set(String(row.ticker), String(row.fetched_at));
  }
  return stored;
}

/**
 * Completes the snapshot's requests. The `requested_at` guard means a slow run can never close a request
 * a user queued after it started: that newer request stays queued for the next run.
 */
export async function completeRequests(
  d1: D1Query, snapshot: RequestSnapshot, outcomes: Record<string, QuoteOutcome>, failureMessage = 'Prices could not be refreshed.', now = new Date().toISOString(),
) {
  for (const [ticker, requestedAt] of snapshot) {
    const outcome = outcomes[ticker] ?? 'failed';
    await d1(
      `UPDATE refresh_requests SET status=?, outcome=?, completed_at=?, error=? WHERE kind='quotes' AND ticker=? AND requested_at=?`,
      [outcome === 'failed' ? 'failed' : 'completed', outcome, now, outcome === 'failed' ? failureMessage : null, ticker, requestedAt],
    );
  }
}

/** A whole-run failure (PSX unreachable, D1 down): every request of the snapshot fails with a generic note. */
export async function failRequests(d1: D1Query, snapshot: RequestSnapshot) {
  await completeRequests(d1, snapshot, Object.fromEntries([...snapshot.keys()].map((ticker) => [ticker, 'failed' as const])));
}
