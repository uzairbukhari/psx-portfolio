// The mobile transport for the vault routes and the public-data client. Both carry only key material, ciphertext
// and ticker symbols; the decrypted portfolio never goes through here.
import { createPublicData } from '../../../lib/public-data-client.ts';
import type { PublicData } from '../../../lib/portfolio-view.ts';
import { TransportError, type VaultTransport } from '../../../lib/vault-client.ts';
import { ApiRequestError } from '../api/client.ts';

type Api = {
  get: <T>(path: string) => Promise<T>;
  post: <T>(path: string, data?: unknown) => Promise<T>;
  put: <T>(path: string, data: unknown) => Promise<T>;
  delete: <T>(path: string, data?: unknown) => Promise<T>;
};

const asTransportError = (error: unknown) =>
  error instanceof ApiRequestError ? new TransportError(error.message, error.status, error.code) : error;

async function guard<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw asTransportError(error);
  }
}

export function mobileVaultTransport(api: Api): VaultTransport {
  return {
    getVault: () => guard(api.get('/api/vault')),
    postVault: (request) => guard(api.post('/api/vault', request)),
    putWrappers: (request) => guard(api.put('/api/vault', request)),
    deleteVault: async () => void (await guard(api.delete('/api/vault', { confirm: true }))),
    getPortfolio: () => guard(api.get('/api/v3/portfolio')),
    putPortfolio: (request) => guard(api.put('/api/v3/portfolio', request)),
  };
}

export function mobilePublicData(api: Api): PublicData {
  return createPublicData((path, method = 'GET', body) =>
    guard(
      method === 'GET' ? api.get(path)
      : method === 'POST' ? api.post(path, body)
      : method === 'PUT' ? api.put(path, body)
      : api.delete(path, body),
    ),
  );
}
