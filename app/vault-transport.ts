// Browser transport for the vault routes (key material and ciphertext only) and the public-data client the
// decrypted portfolio is merged with. Neither ever sends portfolio content: only ciphertext, wrappers and tickers.
import type { PublicData } from '@/lib/portfolio-view';
import { createPublicData } from '@/lib/public-data-client';
import { TransportError, type VaultTransport } from '@/lib/vault-client';

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  try {
    return await attempt<T>(path, method, body);
  } catch (e) {
    // A read that hit a passing Cloudflare error page (1102, 5xx) or an empty answer is asked once more before it is shown.
    if (method !== 'GET' || !(e instanceof TransportError) || (e.status > 0 && e.status < 500 && e.status !== 200)) throw e;
    await new Promise((r) => setTimeout(r, 1200));
    return attempt<T>(path, method, body);
  }
}

// Public answers that are the same for everyone and change at most daily: the server already sends
// `private, max-age=900`, so the browser may reuse them instead of asking again on every refresh.
const CACHEABLE = /^\/api\/public-data\/(metals|fx|plan-navs|funds(\?(fund|payouts)=[\w%,]+)?)$/;
// After the server was told about funds (it may fetch prices then) the catalogue may have changed: the next read of it goes to the network.
let catalogueStale = false;

function cacheMode(path: string, method: string): RequestCache {
  if (method !== 'GET' || !CACHEABLE.test(path)) return 'no-store';
  if (path === '/api/public-data/funds' && catalogueStale) {
    catalogueStale = false;
    return 'reload';
  }
  return 'default';
}

async function attempt<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: cacheMode(path, method),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TransportError('Could not reach the server. Check your connection.', 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) throw new TransportError(data?.error ?? 'The request failed. Try again.', res.status, data?.code);
  if (data === null) throw new TransportError('The server sent an empty or unreadable answer. Try again in a moment.', res.status);
  if (method === 'POST' && path === '/api/public-data/funds') catalogueStale = true;
  return data as T;
}

export const webVaultTransport: VaultTransport = {
  getVault: () => call('/api/vault'),
  postVault: (request) => call('/api/vault', 'POST', request),
  putWrappers: (request) => call('/api/vault', 'PUT', request),
  deleteVault: async () => void (await call('/api/vault', 'DELETE', { confirm: true })),
  getPortfolio: () => call('/api/v3/portfolio'),
  putPortfolio: (request) => call('/api/v3/portfolio', 'PUT', request),
};

export const webPublicData: PublicData = createPublicData(call);
