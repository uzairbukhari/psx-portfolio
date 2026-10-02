// Request handling for /api/companies, kept free of Worker-only imports so it is testable against the D1
// look-alike (the route file only adds authentication and the Worker bindings).
import type { CompaniesResponse } from './api-types.ts';
import { cleanLookupTickers, lookupCompanies } from './company-resolver.ts';
import { dispatchBlockedReason, type DispatchConfig } from './github-dispatch.ts';
import { takeRateLimit } from './rate-limit.ts';
import { UserError } from './user-error.ts';
import { requestRefresh } from './workflow-requests.ts';

/** Per account: each call can start a GitHub workflow run, so lookups are limited. */
export const COMPANY_LOOKUP_LIMIT = { windowMs: 60 * 60_000, max: 30 };
/** Most symbols one request may queue (one dispatch covers them all). */
export const MAX_REQUEST_LOOKUPS = 25;

/** Cached state only. Never dispatches, never writes. */
export async function companyStatus(db: D1Database, tickersInput: unknown, config: DispatchConfig, now = Date.now()): Promise<CompaniesResponse> {
  const tickers = cleanLookupTickers(tickersInput);
  return { companies: tickers.length ? await lookupCompanies(db, tickers, now) : [], dispatchEnabled: dispatchBlockedReason(config) === null };
}

/**
 * Queues one background lookup for the symbols that are neither resolved nor already being looked up.
 * Duplicates and symbols already in flight are folded into one request; resolved symbols cost nothing.
 */
export async function requestCompanyLookup(
  db: D1Database,
  user: string,
  tickersInput: unknown,
  config: DispatchConfig,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<CompaniesResponse> {
  const tickers = cleanLookupTickers(tickersInput, MAX_REQUEST_LOOKUPS);
  if (!tickers.length) throw new UserError('Enter a valid PSX symbol (2-12 letters or digits).');
  const before = await lookupCompanies(db, tickers, now);
  const wanted = before.filter((c) => c.state === 'unresolved').map((c) => c.ticker);
  let queued: string[] = [];
  let message = wanted.length ? undefined : 'Company details are already available or being looked up.';
  if (wanted.length) {
    if (dispatchBlockedReason(config)) message = 'Company lookups are not available right now.';
    else {
      const decision = await takeRateLimit(db, user, 'company-lookup', COMPANY_LOOKUP_LIMIT, new Date(now));
      if (!decision.allowed) throw new UserError(`Too many company lookups. Try again in ${Math.ceil(decision.retryAfterMs / 60_000)} minutes.`, 429);
      const result = await requestRefresh(db, config, 'company', wanted, now, fetcher);
      queued = result.queued;
      message = result.dispatched ? 'Looking up company details. This can take a few minutes.' : 'A lookup for these companies is already running.';
      if (!result.dispatched && !result.alreadyRunning.length) message = 'The lookup could not be started right now. Please try again later.';
    }
  }
  return { companies: await lookupCompanies(db, tickers, now), dispatchEnabled: dispatchBlockedReason(config) === null, queued, message };
}
