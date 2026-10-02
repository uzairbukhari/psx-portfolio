// Short-lived per-isolate cache for owner-authorised pyPSX intraday reads. Ordinary market-summary
// reads used to call pyPSX once per shortlist symbol on every request with no timeout. Here a
// result is reused for `ttlMs`, concurrent callers share one in-flight request, a request is
// bounded by `timeoutMs`, and an older observation can never replace a newer one. A failure is
// cached briefly so an outage is not hammered. (Each Worker isolate has its own cache.)
import type { PypsxIntradaySnapshot } from './pypsx-market.ts';

export const INTRADAY_TTL_MS = 30_000;
export const INTRADAY_FAILURE_TTL_MS = 15_000;
export const INTRADAY_TIMEOUT_MS = 6_000;
const MAX_ENTRIES = 200;

type Entry = { at: number; value: PypsxIntradaySnapshot | null; failed: boolean };

export type IntradayCacheOptions = {
  fetchOne: (key: string, signal: AbortSignal) => Promise<PypsxIntradaySnapshot | null>;
  now?: () => number;
  ttlMs?: number;
  failureTtlMs?: number;
  timeoutMs?: number;
};

export function createIntradayCache(options: IntradayCacheOptions) {
  const { fetchOne, now = Date.now, ttlMs = INTRADAY_TTL_MS, failureTtlMs = INTRADAY_FAILURE_TTL_MS, timeoutMs = INTRADAY_TIMEOUT_MS } = options;
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<PypsxIntradaySnapshot | null>>();
  let providerCalls = 0;

  const newer = (candidate: PypsxIntradaySnapshot | null, current: PypsxIntradaySnapshot | null) =>
    !current || (candidate !== null && (candidate.sourceTimestamp ?? '') >= (current.sourceTimestamp ?? ''));

  async function load(key: string): Promise<PypsxIntradaySnapshot | null> {
    const existing = inflight.get(key);
    if (existing) return existing;
    const promise = (async () => {
      providerCalls++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const value = await fetchOne(key, controller.signal);
        const previous = entries.get(key)?.value ?? null;
        // Out-of-order protection: an older observation never replaces a newer one.
        const kept = newer(value, previous) ? value : previous;
        if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
        entries.set(key, { at: now(), value: kept, failed: false });
        return kept;
      } catch {
        const previous = entries.get(key)?.value ?? null;
        entries.set(key, { at: now(), value: previous, failed: true });
        return null;
      } finally {
        clearTimeout(timer);
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  return {
    async get(key: string): Promise<PypsxIntradaySnapshot | null> {
      const hit = entries.get(key);
      if (hit && now() - hit.at < (hit.failed ? failureTtlMs : ttlMs)) return hit.failed ? null : hit.value;
      return load(key);
    },
    /** Provider requests actually made (for health / tests). */
    get providerCalls() { return providerCalls; },
  };
}
