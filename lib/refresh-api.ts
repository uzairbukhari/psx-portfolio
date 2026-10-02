// Request handling for the two on-demand fetch endpoints, kept free of Worker-only imports so it can be
// tested against the D1 look-alike. The route files only add authentication and the Worker bindings.
import type { DividendRefreshResponse, IpoOffersResponse } from './api-types.ts';
import type { DispatchConfig } from './github-dispatch.ts';
import { dispatchBlockedReason } from './github-dispatch.ts';
import { readAnnouncements } from './dividend-announcements.ts';
import { historicalTickers } from './dividend-history.ts';
import { CURATED_IPO_OFFERS, lookupFromRow, type IpoRow } from './ipo-evidence.ts';
import type { Portfolio } from './portfolio.ts';
import { takeRateLimit } from './rate-limit.ts';
import { UserError } from './user-error.ts';
import { MAX_REQUEST_TICKERS, overallState, readRequests, requestRefresh, tickerState, type RequestKind } from './workflow-requests.ts';

const TICKER = /^[A-Z0-9]{2,12}$/;
/** Per-account limits: each request can start a GitHub workflow run. */
export const DIVIDEND_REFRESH_LIMIT = { windowMs: 6 * 3_600_000, max: 6 };
export const IPO_LOOKUP_LIMIT = { windowMs: 24 * 3_600_000, max: 10 };
export const MAX_IPO_TICKERS = 5;

const statesFor = async (db: D1Database, kind: RequestKind, tickers: string[], now: number) => {
  const rows = await readRequests(db, kind, tickers);
  const states = tickers.map((t) => tickerState(rows.get(t), t, now));
  return { states, overall: overallState(states) };
};

export async function dividendRefreshStatus(
  db: D1Database,
  portfolio: Portfolio,
  revision: number,
  config: DispatchConfig,
  now = Date.now(),
): Promise<DividendRefreshResponse> {
  const tickers = historicalTickers(portfolio);
  const { states, overall } = await statesFor(db, 'payouts', tickers, now);
  const announcements = tickers.length ? await readAnnouncements(db, tickers).catch(() => []) : [];
  const blocked = dispatchBlockedReason(config);
  return { revision, tickers, states, overall, announcements, dispatchEnabled: blocked === null, disabledReason: blocked };
}

/**
 * Starts a refresh for the ledger's own historical tickers. A client may narrow the list but never widen it:
 * anything outside the user's active trade history is ignored, so the endpoint cannot be used to fan out
 * arbitrary symbols.
 */
export async function requestDividendRefresh(
  db: D1Database,
  user: string,
  portfolio: Portfolio,
  revision: number,
  config: DispatchConfig,
  asked: unknown,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<DividendRefreshResponse> {
  const eligible = historicalTickers(portfolio);
  const wanted = Array.isArray(asked) ? asked.filter((t): t is string => typeof t === 'string') : eligible;
  const tickers = eligible.filter((t) => wanted.includes(t)).slice(0, MAX_REQUEST_TICKERS);
  if (!tickers.length) throw new UserError('There are no companies in your trade history to refresh.');
  const blocked = dispatchBlockedReason(config);
  let result;
  if (blocked) result = { dispatched: false, queued: [] as string[], alreadyRunning: [] as string[], reason: blocked };
  else {
    const decision = await takeRateLimit(db, user, 'dividend-history-refresh', DIVIDEND_REFRESH_LIMIT, new Date(now));
    if (!decision.allowed)
      throw new UserError(`Announcement refresh limit reached. Try again in ${Math.ceil(decision.retryAfterMs / 60_000)} minutes.`, 429);
    result = await requestRefresh(db, config, 'payouts', tickers, now, fetcher);
  }
  const status = await dividendRefreshStatus(db, portfolio, revision, config, now);
  return {
    ...status,
    queued: result.queued,
    alreadyRunning: result.alreadyRunning,
    message: result.dispatched
      ? `Fetching PSX announcements for ${result.queued.length} compan${result.queued.length === 1 ? 'y' : 'ies'}.`
      : (result.reason ?? 'Nothing to fetch.'),
  };
}

const cleanTickers = (value: unknown) =>
  [...new Set(Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])]
    .map((t) => String(t).trim().toUpperCase())
    .filter((t) => TICKER.test(t))
    .slice(0, MAX_IPO_TICKERS);

export async function ipoStatus(db: D1Database, tickersInput: unknown, config: DispatchConfig, now = Date.now()): Promise<IpoOffersResponse> {
  const tickers = cleanTickers(tickersInput);
  const rows = tickers.length
    ? (await db.prepare(`SELECT * FROM ipo_offers WHERE ticker IN (${tickers.map(() => '?').join(',')})`).bind(...tickers).all<IpoRow>()).results
    : [];
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  const { states, overall } = await statesFor(db, 'ipo', tickers, now);
  const blocked = dispatchBlockedReason(config);
  return { lookups: tickers.map((t) => lookupFromRow(t, byTicker.get(t))), states, overall, dispatchEnabled: blocked === null, disabledReason: blocked };
}

export async function requestIpoLookup(
  db: D1Database,
  user: string,
  tickersInput: unknown,
  config: DispatchConfig,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<IpoOffersResponse> {
  const curated = new Set(CURATED_IPO_OFFERS.map((c) => c.ticker));
  const tickers = cleanTickers(tickersInput).filter((t) => !curated.has(t));
  let message = 'Nothing to look up: official evidence is already on file.';
  let queued: string[] = [];
  if (tickers.length) {
    const blocked = dispatchBlockedReason(config);
    if (blocked) message = blocked;
    else {
      const decision = await takeRateLimit(db, user, 'ipo-lookup', IPO_LOOKUP_LIMIT, new Date(now));
      if (!decision.allowed) throw new UserError('IPO lookup limit reached for today.', 429);
      const result = await requestRefresh(db, config, 'ipo', tickers, now, fetcher);
      queued = result.queued;
      message = result.dispatched ? 'Looking up official offer documents.' : (result.reason ?? 'Nothing to look up.');
    }
  }
  return { ...(await ipoStatus(db, tickersInput, config, now)), queued, message };
}
