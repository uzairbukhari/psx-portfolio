// Edge cache for public data that is identical for every user (metal rates, the fund catalogue, one fund's price
// history). The route still checks the session first; only the D1 read is skipped. Never put anything user-specific
// or ticker-list shaped through this: the key is a fixed string chosen by the route, never the request URL.
const ORIGIN = 'https://edge-cache.sipwise.internal/';

type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

export async function edgeCached<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
  waitUntil?: (work: Promise<unknown>) => void,
  cache: CacheLike | undefined = (globalThis as { caches?: { default?: CacheLike } }).caches?.default,
): Promise<T> {
  // Node (tests, scripts) has no Cache API: just load.
  if (!cache) return load();
  const request = new Request(ORIGIN + encodeURIComponent(key));
  try {
    const hit = await cache.match(request);
    if (hit) return (await hit.json()) as T;
  } catch {
    // A broken cache must never break the page.
  }
  const value = await load();
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
