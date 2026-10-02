// Guards for the owner-only pyPSX live stream: reject out-of-order ticks, and bound how long a
// connection may stay open or silent. A connected socket alone never means a fresh quote: each
// forwarded update says whether the provider stated when it was quoted.
import type { PypsxLiveQuote } from './pypsx-market.ts';

export const STREAM_CONNECT_TIMEOUT_MS = 10_000;
export const STREAM_IDLE_MS = 90_000;
export const STREAM_MAX_MS = 30 * 60_000;

export function createStreamGate(options: { now?: () => number; idleMs?: number; maxMs?: number } = {}) {
  const { now = Date.now, idleMs = STREAM_IDLE_MS, maxMs = STREAM_MAX_MS } = options;
  const startedAt = now();
  let lastMessageAt = startedAt;
  const latest = new Map<string, string>();
  return {
    /** Call for every provider message, even ones carrying no quote (keeps the idle timer honest). */
    heard() { lastMessageAt = now(); },
    /** Returns the update to forward, or null when it is older than one already forwarded. */
    accept(update: PypsxLiveQuote): (PypsxLiveQuote & { timeKnown: boolean }) | null {
      const stamp = update.sourceTimestamp;
      if (stamp) {
        const seen = latest.get(update.ticker);
        if (seen && Date.parse(stamp) < Date.parse(seen)) return null;
        latest.set(update.ticker, stamp);
      }
      return { ...update, timeKnown: Boolean(stamp) };
    },
    /** Why the connection should be closed now, or null. */
    expiry(): 'idle' | 'max-age' | null {
      const t = now();
      if (t - startedAt > maxMs) return 'max-age';
      if (t - lastMessageAt > idleMs) return 'idle';
      return null;
    },
  };
}
