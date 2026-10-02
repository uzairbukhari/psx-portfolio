// Session-aware freshness for every market datum (quotes, indices, facts, history). Fetch time alone
// never makes data "fresh": during a session the observation itself must be recent, and outside a
// session it must come from the latest completed trading session. When the source does not state
// when a value was quoted, only its retrieval age can be reported, never a claim of fresh pricing.
import { pakistanMarketState, pktDateOf } from './psx-market.ts';
import { lastSessionClose } from './quote-cache.ts';

import type { DataMeta, Freshness, TimestampPrecision } from './market-meta.ts';
export type { DataMeta, Freshness, TimestampPrecision };

/** During a session, an observation older than this is stale. */
export const OPEN_STALE_MS = 10 * 60_000;

/** PKT date of the most recent trading session that has finished (close + grace) at `now`. */
export const latestCompletedSession = (now: Date) => pktDateOf(lastSessionClose(now));

export type ObservationInput = {
  sourceTimestamp?: string | null;
  /** Trading day the source attributes the value to (YYYY-MM-DD), when it gives one without a time. */
  sessionDate?: string | null;
  fetchedAt?: string | null;
  now?: Date;
};
export type Classification = Pick<DataMeta, 'freshness' | 'reason' | 'session' | 'sessionInferred' | 'ageSeconds' | 'timestampPrecision'>;

const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));
const valid = (iso?: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : null);

export function classifyObservation(input: ObservationInput): Classification {
  const now = input.now ?? new Date();
  const source = valid(input.sourceTimestamp);
  const fetched = valid(input.fetchedAt);
  const dated = input.sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate) ? input.sessionDate : null;
  if (source === null && fetched === null && !dated)
    return { freshness: 'unavailable', reason: 'No observation has been recorded.', session: null, sessionInferred: false, ageSeconds: null, timestampPrecision: 'unknown' };

  const sessionInferred = source === null && !dated;
  const session = dated ?? (source !== null ? pktDateOf(new Date(source)) : pktDateOf(new Date(fetched!)));
  const precision: TimestampPrecision = source !== null ? 'second' : dated ? 'day' : 'unknown';
  const observedAt = source ?? fetched;
  const ageMs = observedAt === null ? null : Math.max(0, now.getTime() - observedAt);
  const ageSeconds = ageMs === null ? null : Math.round(ageMs / 1000);
  const base = { session, sessionInferred, ageSeconds, timestampPrecision: precision };
  const market = pakistanMarketState(now);

  if (market.isOpen) {
    if (session !== pktDateOf(now))
      return { ...base, freshness: 'stale', reason: `The market is open but the latest value is from the ${session} session.` };
    if (source !== null)
      return ageMs! <= OPEN_STALE_MS
        ? { ...base, freshness: 'fresh', reason: `Quoted ${minutes(ageMs!)} min ago.` }
        : { ...base, freshness: 'stale', reason: `Quoted ${minutes(ageMs!)} min ago, over the ${minutes(OPEN_STALE_MS)}-minute limit while the market is open.` };
    // No source time: say how long ago it was retrieved, and do not claim the quote itself is fresh.
    return fetched !== null && now.getTime() - fetched <= OPEN_STALE_MS
      ? { ...base, freshness: 'delayed', reason: `Retrieved ${minutes(now.getTime() - fetched)} min ago; the source does not say when the value was quoted.` }
      : { ...base, freshness: 'stale', reason: `Retrieved ${fetched === null ? 'at an unknown time' : `${minutes(now.getTime() - fetched)} min ago`}; the source does not say when the value was quoted.` };
  }

  const latest = latestCompletedSession(now);
  if (session >= latest) {
    if (sessionInferred)
      return { ...base, freshness: 'delayed', reason: `Retrieved after the ${latest} close; the source does not state its session, so it is assumed to belong to it.` };
    return { ...base, freshness: 'fresh', reason: `From the latest completed session (${latest}).` };
  }
  return { ...base, freshness: 'stale', reason: `Latest value is from the ${session} session; the latest completed session is ${latest}.` };
}

/** Builds the shared metadata for one observation. A failed refresh never refreshes the age of old data. */
export function dataMeta(input: ObservationInput & {
  provider: string;
  sourceUrl?: string | null;
  lastSuccessAt?: string | null;
  lastFailure?: { at: string; message: string } | null;
}): DataMeta {
  const classified = classifyObservation(input);
  return {
    provider: input.provider,
    sourceUrl: input.sourceUrl ?? null,
    sourceTimestamp: valid(input.sourceTimestamp) === null ? null : (input.sourceTimestamp as string),
    fetchedAt: valid(input.fetchedAt) === null ? null : (input.fetchedAt as string),
    ...classified,
    lastSuccessAt: input.lastSuccessAt ?? input.fetchedAt ?? null,
    lastFailure: input.lastFailure ?? null,
  };
}
