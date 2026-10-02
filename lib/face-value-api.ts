// Request handling for /api/face-values (dividend review): verified face-value evidence for the ledger's own
// companies, and a background fetch for the ones that have none. Free of Worker-only imports for testing.
import type { FaceValuesResponse } from './api-types.ts';
import { historicalTickers } from './dividend-history.ts';
import { readFaceValues } from './face-values.ts';
import { dispatchBlockedReason, type DispatchConfig } from './github-dispatch.ts';
import type { Portfolio } from './portfolio.ts';
import { takeRateLimit } from './rate-limit.ts';
import { UserError } from './user-error.ts';
import { MAX_REQUEST_TICKERS, overallState, readRequests, requestRefresh, tickerState } from './workflow-requests.ts';

export const FACE_VALUE_LIMIT = { windowMs: 6 * 3_600_000, max: 6 };

/** The ledger's companies, optionally narrowed by the caller (never widened). */
function scope(portfolio: Portfolio, asked: unknown): string[] {
  const eligible = historicalTickers(portfolio);
  const wanted = Array.isArray(asked) ? asked.filter((t): t is string => typeof t === 'string') : eligible;
  return eligible.filter((t) => wanted.includes(t));
}

export async function faceValueStatus(db: D1Database, portfolio: Portfolio, config: DispatchConfig, asked?: unknown, now = Date.now()): Promise<FaceValuesResponse> {
  const tickers = scope(portfolio, asked);
  const evidence = tickers.length ? await readFaceValues(db, tickers) : {};
  const requests = await readRequests(db, 'facevalue', tickers);
  const states = tickers.map((t) => tickerState(requests.get(t), t, now));
  const blocked = dispatchBlockedReason(config);
  return { tickers, evidence, states, overall: overallState(states), dispatchEnabled: blocked === null, disabledReason: blocked };
}

/** Queues one fetch for the ledger's companies that have no evidence yet. */
export async function requestFaceValues(
  db: D1Database,
  user: string,
  portfolio: Portfolio,
  config: DispatchConfig,
  asked: unknown,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<FaceValuesResponse> {
  const tickers = scope(portfolio, asked);
  if (!tickers.length) throw new UserError('There are no companies in your trade history to look up.');
  const evidence = await readFaceValues(db, tickers);
  const missing = tickers.filter((t) => !evidence[t]?.length).slice(0, MAX_REQUEST_TICKERS);
  let queued: string[] = [];
  let message = missing.length ? undefined : 'Face values are already on file for these companies.';
  if (missing.length) {
    if (dispatchBlockedReason(config)) message = 'Face value lookups are not available right now.';
    else {
      const decision = await takeRateLimit(db, user, 'face-value-fetch', FACE_VALUE_LIMIT, new Date(now));
      if (!decision.allowed) throw new UserError(`Face value lookup limit reached. Try again in ${Math.ceil(decision.retryAfterMs / 60_000)} minutes.`, 429);
      const result = await requestRefresh(db, config, 'facevalue', missing, now, fetcher);
      queued = result.queued;
      message = result.dispatched ? 'Looking for verified face values.' : result.alreadyRunning.length ? 'A face value lookup is already running.' : 'The lookup could not be started right now. Please try again later.';
    }
  }
  return { ...(await faceValueStatus(db, portfolio, config, asked, now)), queued, message };
}
