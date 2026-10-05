// Browser transport for the vault routes (key material and ciphertext only) and the public-data client the
// decrypted portfolio is merged with. Neither ever sends portfolio content: only ciphertext, wrappers and tickers.
import type { PublicData } from '@/lib/portfolio-view';
import { createPublicData } from '@/lib/public-data-client';
import { TransportError, type VaultTransport } from '@/lib/vault-client';

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new TransportError('Could not reach the server. Check your connection.', 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) throw new TransportError(data?.error ?? 'The request failed. Try again.', res.status, data?.code);
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
