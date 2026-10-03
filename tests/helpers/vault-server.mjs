// A VaultTransport backed by the real request handlers (lib/vault-api.ts) over a real SQLite vault database, so
// client behaviour is tested end to end without Cloudflare. `as(email)` returns the transport one signed-in
// session would have; failures map to TransportError exactly like the fetch/mobile transports do.
import { createD1, vaultMigrationsDir } from './d1.mjs';
import * as api from '../../lib/vault-api.ts';
import { TransportError } from '../../lib/vault-client.ts';

export function createVaultServer() {
  const db = createD1(vaultMigrationsDir);
  const log = [];
  const state = { offline: false, delay: 0, hold: null };
  async function call(owner, method, path, handler, body) {
    log.push({ owner, method, path, body: body === undefined ? undefined : JSON.stringify(body) });
    if (state.offline) throw new TransportError('offline', 0);
    if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
    if (state.hold) await state.hold;
    const req = new Request(`https://app.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    try {
      const res = await handler(req);
      return await res.json();
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError(error.message, error.status ?? 500, error.code);
    }
  }
  const as = (email) => ({
    getVault: () => call(email, 'GET', '/api/vault', () => api.getVault(db, email)),
    postVault: (b) => call(email, 'POST', '/api/vault', (req) => api.postVault(db, email, req), b),
    putWrappers: (b) => call(email, 'PUT', '/api/vault', (req) => api.putVaultWrappers(db, email, req), b),
    deleteVault: () => call(email, 'DELETE', '/api/vault', (req) => api.deleteOwnVault(db, email, req), { confirm: true }),
    getPortfolio: () => call(email, 'GET', '/api/v2/portfolio', () => api.getCiphertext(db, email)),
    putPortfolio: (b) => call(email, 'PUT', '/api/v2/portfolio', (req) => api.putCiphertext(db, email, req), b),
  });
  return { db, as, log, state };
}

export function memoryVaultCache() {
  let value = null;
  return { read: async () => value, write: (v) => { value = JSON.parse(JSON.stringify(v)); }, clear: () => { value = null; }, peek: () => value };
}
