// Edge cache for public data that is identical for every user (metal rates, the fund catalogue, one fund's price
// history). The route still checks the session first; only the D1 read is skipped. Never put anything user-specific
// or ticker-list shaped through this: the key is a fixed string chosen by the route, never the request URL.
const ORIGIN = 'https://edge-cache.sipwise.internal/';

type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

// workers.dev hosts (staging) accept Cache API calls but never store them, so the same answer is also kept in the
// isolate's memory for the same time. Per cache object, so tests with separate fake caches stay apart.
const memory = new WeakMap<object, Map<string, { until: number; value: unknown }>>();

export async function edgeCached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  waitUntil?: (work: Promise<unknown>) => void,
  cache: CacheLike | undefined = (globalThis as { caches?: { default?: CacheLike } }).caches?.default,
  /** Answers it returns false for (for example "no rates yet") are served but not kept, so the next request asks again. */
  worthCaching: (value: T) => boolean = () => true,
): Promise<T> {
  // Node (tests, scripts) has no Cache API: just load.
  if (!cache) return load();
  let mem = memory.get(cache);
  if (!mem) memory.set(cache, (mem = new Map()));
  const held = mem.get(key);
  if (held && held.until > Date.now()) return held.value as T;
  const request = new Request(ORIGIN + encodeURIComponent(key));
  try {
    const hit = await cache.match(request);
    if (hit) {
      const value = (await hit.json()) as T;
      mem.set(key, { until: Date.now() + ttlSeconds * 1000, value });
      return value;
    }
  } catch {
    // A broken cache must never break the page.
  }
  const value = await load();
  if (!worthCaching(value)) return value;
  mem.set(key, { until: Date.now() + ttlSeconds * 1000, value });
  const store = cache
    .put(
      request,
      new Response(JSON.stringify(value), {
        headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` },
      }),
    )
    .catch(() => {});
  if (waitUntil) waitUntil(store);
  else await store;
  return value;
}
