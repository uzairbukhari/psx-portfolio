// The admin console's reports are read by one or two people, but each one is a few dozen D1 queries, and the pages poll.
// They are served from the edge cache for a couple of minutes so open tabs, several tabs and reloads cost one set of reads
// per window. The route checks the super admin session first; only the D1 work is skipped. `?fresh=1` (the Reload
// button) always recomputes. Never put per-account lookups that are logged (a person's timeline) through this.
import { edgeCached } from './edge-cache.ts';

export const ADMIN_CACHE_SECONDS = 120;

export function adminCached<T>(
  req: Request,
  name: string,
  load: () => Promise<T>,
  waitUntil?: (work: Promise<unknown>) => void,
  ttlSeconds = ADMIN_CACHE_SECONDS,
): Promise<T> {
  if (new URL(req.url).searchParams.get('fresh') === '1') return load();
  return edgeCached(`admin:${name}`, ttlSeconds, load, waitUntil);
}
