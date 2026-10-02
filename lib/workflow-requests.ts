// On-demand GitHub Actions scrapes with durable per-company state (`refresh_requests`).
//
// PSX drops Cloudflare egress, so the Worker cannot fetch announcements or offer documents itself: it
// records a request, dispatches a workflow, and reads back what the scraper wrote. This module is the
// shared bookkeeping for the historical dividend refresh (`payouts`) and the IPO evidence lookup (`ipo`).
//  - one request per (kind, ticker) is in flight at a time; a repeat within the window is deduplicated;
//  - a dispatch that GitHub refused is marked failed immediately, so it can never sit "in flight";
//  - a queued/running request that never finishes is reported as timed out instead of running forever;
//  - the production-writing workflows are never dispatched from staging (see dispatchBlockedReason).
import { dispatchBlockedReason, type DispatchConfig } from './github-dispatch.ts';

export type RequestKind = 'payouts' | 'ipo' | 'company' | 'quotes';
export const WORKFLOWS: Record<RequestKind, string> = {
  payouts: 'psx-payouts.yml', ipo: 'psx-ipo.yml', company: 'psx-directory.yml', quotes: 'psx-quotes.yml',
};
/**
 * The `inputs` each workflow declares (GitHub rejects an undeclared input). The quote scraper declares none:
 * it serves every open `quotes` request it finds in D1, so a delayed or lost dispatch loses nothing.
 */
export const workflowInputs = (kind: RequestKind, tickers: string[]): Record<string, string> | undefined =>
  kind === 'quotes' ? undefined : kind === 'company' ? { tickers: tickers.join(','), mode: 'incremental' } : { tickers: tickers.join(',') };
/** A queued or running request older than this is reported as timed out. */
export const REQUEST_TIMEOUT_MS = 20 * 60_000;
/** Most tickers one request may cover. */
export const MAX_REQUEST_TICKERS = 40;
const TICKER = /^[A-Z0-9]{2,12}$/;

export type RequestRow = {
  kind: RequestKind;
  ticker: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  requested_at: string;
  dispatched_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  attempts: number;
  rows_found: number | null;
  coverage_from: string | null;
  error: string | null;
  outcome?: string | null;
};

export type TickerState = {
  ticker: string;
  state: 'none' | 'queued' | 'running' | 'completed' | 'failed';
  requestedAt?: string;
  completedAt?: string;
  /** Announcements (payouts) found by the last successful fetch; 0 is a successful empty result. */
  rowsFound?: number | null;
  /** Earliest announcement date the source returned: history before it is not covered. */
  coverageFrom?: string | null;
  error?: string | null;
  attempts?: number;
};

/** The user-visible state of one ticker's request at `now`. */
export function tickerState(row: RequestRow | undefined, ticker: string, now: number): TickerState {
  if (!row) return { ticker, state: 'none' };
  const age = now - Date.parse(row.requested_at);
  const base = {
    ticker, requestedAt: row.requested_at, completedAt: row.completed_at ?? undefined,
    rowsFound: row.rows_found, coverageFrom: row.coverage_from, attempts: row.attempts,
  };
  if ((row.status === 'queued' || row.status === 'running') && age > REQUEST_TIMEOUT_MS)
    return { ...base, state: 'failed', error: 'The fetch did not finish in time. Try again.' };
  return { ...base, state: row.status, error: row.error };
}

export type OverallState = 'idle' | 'queued' | 'running' | 'completed' | 'partial' | 'failed';
export function overallState(states: TickerState[]): OverallState {
  if (!states.length || states.every((s) => s.state === 'none')) return 'idle';
  if (states.some((s) => s.state === 'running')) return 'running';
  if (states.some((s) => s.state === 'queued')) return 'queued';
  const done = states.filter((s) => s.state === 'completed').length;
  const failed = states.filter((s) => s.state === 'failed').length;
  if (failed && done) return 'partial';
  if (failed) return 'failed';
  if (done < states.length) return 'partial'; // some tickers never requested
  return 'completed';
}

export async function readRequests(db: D1Database, kind: RequestKind, tickers: string[]) {
  const unique = [...new Set(tickers)].filter((t) => TICKER.test(t));
  if (!unique.length) return new Map<string, RequestRow>();
  const rows = (
    await db
      .prepare(`SELECT * FROM refresh_requests WHERE kind=? AND ticker IN (${unique.map(() => '?').join(',')})`)
      .bind(kind, ...unique)
      .all<RequestRow>()
  ).results;
  return new Map(rows.map((row) => [row.ticker, row]));
}

export type RequestResult = {
  dispatched: boolean;
  /** Tickers newly queued by this call. */
  queued: string[];
  /** Tickers skipped because a fetch for them is already in flight. */
  alreadyRunning: string[];
  reason?: string;
};

export async function requestRefresh(
  db: D1Database,
  config: DispatchConfig,
  kind: RequestKind,
  tickers: string[],
  now = Date.now(),
  fetcher: typeof fetch = fetch,
  /** Most tickers this call may cover; quote refreshes pass a larger cap so a portfolio is never truncated. */
  maxTickers = MAX_REQUEST_TICKERS,
): Promise<RequestResult> {
  const unique = [...new Set(tickers)].filter((t) => TICKER.test(t)).slice(0, maxTickers);
  if (!unique.length) return { dispatched: false, queued: [], alreadyRunning: [], reason: 'No tickers to fetch.' };
  const blocked = dispatchBlockedReason(config);
  if (blocked) return { dispatched: false, queued: [], alreadyRunning: [], reason: blocked };
  const existing = await readRequests(db, kind, unique);
  const inFlight = unique.filter((t) => {
    const s = tickerState(existing.get(t), t, now).state;
    return s === 'queued' || s === 'running';
  });
  const toFetch = unique.filter((t) => !inFlight.includes(t));
  if (!toFetch.length)
    return { dispatched: false, queued: [], alreadyRunning: inFlight, reason: 'A fetch for these companies is already running.' };
  const at = new Date(now).toISOString();
  // Claim each ticker atomically: the upsert only takes over a request that is not in flight (or that timed
  // out), so two simultaneous callers cannot both dispatch for the same company.
  const cutoff = new Date(now - REQUEST_TIMEOUT_MS).toISOString();
  const claims = await db.batch(
    toFetch.map((ticker) =>
      db
        .prepare(
          `INSERT INTO refresh_requests (kind,ticker,status,requested_at,attempts) VALUES (?,?, 'queued', ?, 1)
           ON CONFLICT(kind,ticker) DO UPDATE SET status='queued', requested_at=excluded.requested_at,
             dispatched_at=NULL, started_at=NULL, completed_at=NULL, error=NULL, outcome=NULL, attempts=refresh_requests.attempts+1
           WHERE refresh_requests.status IN ('completed','failed') OR refresh_requests.requested_at <= ?`,
        )
        .bind(kind, ticker, at, cutoff),
    ),
  );
  const claimed = toFetch.filter((_, index) => (claims[index]?.meta?.changes ?? 0) > 0);
  const lost = toFetch.filter((ticker) => !claimed.includes(ticker));
  inFlight.push(...lost);
  if (!claimed.length)
    return { dispatched: false, queued: [], alreadyRunning: inFlight, reason: 'A fetch for these companies is already running.' };
  toFetch.length = 0;
  toFetch.push(...claimed);
  const fail = async (message: string) => {
    await db
      .batch(
        toFetch.map((ticker) =>
          db
            .prepare(`UPDATE refresh_requests SET status='failed', completed_at=?, error=? WHERE kind=? AND ticker=? AND requested_at=?`)
            .bind(new Date().toISOString(), message, kind, ticker, at),
        ),
      )
      .catch(() => {});
  };
  try {
    const response = await fetcher(
      `https://api.github.com/repos/${config.repo}/actions/workflows/${WORKFLOWS[kind]}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'psx-portfolio-worker',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main', ...(workflowInputs(kind, toFetch) ? { inputs: workflowInputs(kind, toFetch) } : {}) }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      await fail(`Could not start the fetch (GitHub answered ${response.status}).`);
      return { dispatched: false, queued: [], alreadyRunning: inFlight, reason: `GitHub answered ${response.status}.` };
    }
    await db
      .batch(toFetch.map((ticker) => db.prepare('UPDATE refresh_requests SET dispatched_at=? WHERE kind=? AND ticker=? AND requested_at=?').bind(new Date().toISOString(), kind, ticker, at)))
      .catch(() => {});
    return { dispatched: true, queued: toFetch, alreadyRunning: inFlight };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Dispatch failed.';
    await fail(`Could not start the fetch (${reason}).`);
    return { dispatched: false, queued: [], alreadyRunning: inFlight, reason };
  }
}
