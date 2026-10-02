// Company-detail handling for the portfolio route, free of Worker-only imports so it is testable.
//  - `enrichForSave`: a revisioned save fills placeholder details from the directory (and, for the strict
//    Add Company intent, refuses unresolved symbols). Companies the directory cannot resolve are kept as sent
//    and a single background lookup is queued, so valid trades are never lost to a metadata failure.
//  - `overlayForRead`: a GET shows resolved details on placeholder companies without writing anything, so
//    background lookups never bump the portfolio revision behind an open editor; the next save persists them.
import { applyLookups, hasPlaceholderDetails, newTickers } from './company-enrichment.ts';
import { lookupCompanies } from './company-resolver.ts';
import type { DispatchConfig } from './github-dispatch.ts';
import { dispatchBlockedReason } from './github-dispatch.ts';
import type { Portfolio } from './portfolio.ts';
import { UserError } from './user-error.ts';
import { readRequests, requestRefresh } from './workflow-requests.ts';

/** A lookup that finished without resolving a symbol is not retried by every save: wait this long. */
export const LOOKUP_RETRY_MS = 6 * 3_600_000;
const MAX_BACKGROUND_LOOKUPS = 25;

export type EnrichResult = { repaired: string[]; pending: string[]; queued: string[] };

/** Queues one background lookup for unresolved symbols not looked up recently. Never throws. */
export async function queueBackgroundLookups(db: D1Database, config: DispatchConfig, tickers: string[], now = Date.now(), fetcher: typeof fetch = fetch): Promise<string[]> {
  try {
    if (!tickers.length || dispatchBlockedReason(config)) return [];
    const existing = await readRequests(db, 'company', tickers);
    const due = tickers.filter((ticker) => {
      const row = existing.get(ticker);
      if (!row) return true;
      if (row.status === 'queued' || row.status === 'running') return false;
      return now - Date.parse(row.completed_at ?? row.requested_at) >= LOOKUP_RETRY_MS;
    });
    if (!due.length) return [];
    return (await requestRefresh(db, config, 'company', due.slice(0, MAX_BACKGROUND_LOOKUPS), now, fetcher)).queued;
  } catch {
    return [];
  }
}

export async function enrichForSave(
  db: D1Database,
  config: DispatchConfig,
  previous: Portfolio | null,
  incoming: Portfolio,
  createCompanies: readonly string[] = [],
  now = Date.now(),
  fetcher: typeof fetch = fetch,
): Promise<EnrichResult> {
  const added = new Set(newTickers(previous, incoming));
  const present = new Set(incoming.companies.map((c) => c.ticker));
  const strict = [...new Set(createCompanies)];
  for (const ticker of strict) {
    if (!present.has(ticker)) throw new UserError(`${ticker} is not part of this save.`);
    if (!added.has(ticker)) throw new UserError(`${ticker} is already in your portfolio.`);
  }
  const wanted = new Set<string>([...added, ...incoming.companies.filter(hasPlaceholderDetails).map((c) => c.ticker)]);
  if (!wanted.size) return { repaired: [], pending: [], queued: [] };
  let lookups;
  try {
    lookups = await lookupCompanies(db, [...wanted], now);
  } catch (error) {
    if (strict.length) throw new UserError('Company details could not be checked right now. Please try again.', 503);
    console.error('Company lookup failed during save', error);
    return { repaired: [], pending: [...wanted], queued: [] };
  }
  const unresolved = lookups.filter((l) => l.state !== 'resolved').map((l) => l.ticker);
  const blocked = strict.filter((t) => unresolved.includes(t));
  if (blocked.length)
    throw new UserError(
      `Company details for ${blocked.join(', ')} are not available yet. Check the symbol, or wait for the lookup to finish and try again.`,
      422,
    );
  const repaired = applyLookups(incoming.companies, lookups, added);
  const queued = await queueBackgroundLookups(db, config, unresolved, now, fetcher);
  return { repaired, pending: unresolved, queued };
}

/** In-memory repair for a GET: returns the tickers still without resolved details. Writes nothing. */
export async function overlayForRead(db: D1Database, portfolio: Portfolio, now = Date.now()): Promise<string[]> {
  const placeholders = portfolio.companies.filter(hasPlaceholderDetails).map((c) => c.ticker);
  if (!placeholders.length) return [];
  try {
    const lookups = await lookupCompanies(db, placeholders, now);
    applyLookups(portfolio.companies, lookups);
    return lookups.filter((l) => l.state !== 'resolved').map((l) => l.ticker);
  } catch {
    return placeholders;
  }
}
