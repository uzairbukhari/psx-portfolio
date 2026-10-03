// Browser transport for the vault routes (key material and ciphertext only) and the public-data client the
// decrypted portfolio is merged with. Neither ever sends portfolio content: only ciphertext, wrappers and tickers.
import type { CompanyLookup, CompaniesResponse, PublicDataResponse } from '@/lib/api-types';
import type { PublicData } from '@/lib/portfolio-view';
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
  getPortfolio: () => call('/api/v2/portfolio'),
  putPortfolio: (request) => call('/api/v2/portfolio', 'PUT', request),
};

const CHUNK = 50;
const chunks = <T,>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

export const webPublicData: PublicData = {
  async market(tickers) {
    const parts = await Promise.all(chunks(tickers, 100).map((part) => call<PublicDataResponse>(`/api/public-data?tickers=${encodeURIComponent(part.join(','))}`)));
    return {
      tickers,
      quoteRows: parts.flatMap((p) => p.quoteRows),
      announcements: parts.flatMap((p) => p.announcements),
      faceValues: Object.assign({}, ...parts.map((p) => p.faceValues)),
    };
  },
  async companies(tickers): Promise<CompanyLookup[]> {
    const parts = await Promise.all(chunks(tickers, CHUNK).map((part) => call<CompaniesResponse>(`/api/companies?tickers=${encodeURIComponent(part.join(','))}`)));
    return parts.flatMap((p) => p.companies);
  },
  async requestLookup(tickers) {
    for (const part of chunks(tickers, 25)) await call('/api/companies', 'POST', { tickers: part });
  },
};
