import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileAdapter, installMobileCrypto, resetMobileCrypto, NEEDS_NEW_BUILD } from './crypto-setup.ts';
import { isLegacyPlaintextCacheName, vaultCacheName } from './cache-name.ts';
import { assertSecureApiUrl } from './https.ts';
import { mobilePublicData, mobileVaultTransport } from './transport.ts';
import { ApiRequestError } from '../api/client.ts';
import { TransportError } from '../../../lib/vault-client.ts';
import { createVaultKeys, encryptPortfolio, decryptPortfolio, unwrapWithPassword, unwrapWithRecovery, setCryptoAdapter } from '../../../lib/vault-crypto.ts';

const nodeRandom = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

test('without the native random module the app reports a needed update and installs nothing', () => {
  resetMobileCrypto();
  const out = installMobileCrypto(() => { throw new Error('Cannot find native module ExpoCrypto'); });
  assert.deepEqual(out, { ok: false, reason: NEEDS_NEW_BUILD });
  assert.equal(installMobileCrypto(() => { throw new Error('still missing'); }).ok, false, 'a failed setup is retried, never cached as success');
  resetMobileCrypto();
});

test('a short or non-byte random result is rejected rather than used', () => {
  assert.throws(() => createMobileAdapter(() => new Uint8Array(3)).randomBytes(16), /wrong amount/);
  assert.throws(() => createMobileAdapter(() => [1, 2, 3] as unknown as Uint8Array).randomBytes(3), /wrong amount/);
});

test('the mobile (pure-JS AES) adapter round-trips and is wire-compatible with the web (WebCrypto) adapter', async () => {
  resetMobileCrypto();
  assert.deepEqual(installMobileCrypto(() => nodeRandom), { ok: true });
  const keys = await createVaultKeys('correct horse battery staple');
  const ctx = { vaultId: keys.material.vaultId, keyVersion: keys.material.keyVersion, revision: 1 };
  const envelope = await encryptPortfolio(keys.dataKey, ctx.vaultId, ctx.keyVersion, ctx.revision, '{"private":"mobile"}');
  assert.equal(await decryptPortfolio(keys.dataKey, envelope, ctx), '{"private":"mobile"}');
  const material = { ...keys.material, wrapperVersion: 1 as const };
  const viaPassword = await unwrapWithPassword(material, 'correct horse battery staple');
  const viaRecovery = await unwrapWithRecovery(material, keys.recoverySecret);
  assert.deepEqual(viaPassword, keys.dataKey);
  assert.deepEqual(viaRecovery, keys.dataKey);
  // The same envelope opens under the WebCrypto path (what the website uses).
  setCryptoAdapter(null);
  const { webCryptoAes } = await import('../../../lib/vault-crypto.ts');
  setCryptoAdapter({ randomBytes: nodeRandom, ...webCryptoAes(globalThis.crypto.subtle) });
  assert.equal(await decryptPortfolio(keys.dataKey, envelope, ctx), '{"private":"mobile"}');
  resetMobileCrypto();
});

test('cache names are opaque, stable, per account and never contain the email', () => {
  const a = vaultCacheName('Person@Example.com');
  assert.equal(a, vaultCacheName(' person@example.com '));
  assert.notEqual(a, vaultCacheName('other@example.com'));
  assert.match(a, /^vault-[0-9a-f]{16}\.json$/);
  assert.ok(!/person|example/i.test(a));
});

test('only the old readable portfolio cache files are recognised as legacy', () => {
  assert.equal(isLegacyPlaintextCacheName('portfolio-person_example_com.json'), true);
  assert.equal(isLegacyPlaintextCacheName('vault-0123456789abcdef.json'), false);
  assert.equal(isLegacyPlaintextCacheName('image.png'), false);
});

test('deployed builds must use https; http is only for development loopback', () => {
  assert.equal(assertSecureApiUrl('https://app.example.com', 'production'), 'https://app.example.com');
  assert.equal(assertSecureApiUrl('http://10.0.2.2:3000', 'development'), 'http://10.0.2.2:3000');
  assert.equal(assertSecureApiUrl('http://localhost:3000', 'development'), 'http://localhost:3000');
  assert.throws(() => assertSecureApiUrl('http://app.example.com', 'production'), /https/);
  assert.throws(() => assertSecureApiUrl('http://app.example.com', 'development'), /https/);
  assert.throws(() => assertSecureApiUrl('http://localhost:3000', 'staging'), /https/);
  assert.throws(() => assertSecureApiUrl('ftp://x', 'production'), /https/);
  assert.throws(() => assertSecureApiUrl('not a url', 'production'), /valid URL/);
  assert.equal(assertSecureApiUrl('', 'production'), '');
});

test('API failures become transport errors with the status and code the vault client switches on', async () => {
  const api = {
    get: async () => { throw new ApiRequestError('Update required', 426, 'upgrade-required'); },
    post: async () => ({}), put: async () => { throw new ApiRequestError('Could not reach Sipwise.', 0); }, delete: async () => ({}),
  };
  const transport = mobileVaultTransport(api as never);
  await assert.rejects(transport.getVault(), (e: unknown) => e instanceof TransportError && e.status === 426 && e.code === 'upgrade-required');
  await assert.rejects(transport.putPortfolio({} as never), (e: unknown) => e instanceof TransportError && e.status === 0);
});

test('public data requests carry tickers only', async () => {
  const seen: string[] = [];
  const api = {
    get: async (path: string) => { seen.push(path); return path.startsWith('/api/public-data') ? { quoteRows: [], announcements: [], faceValues: {} } : { companies: [] }; },
    post: async (path: string, body: unknown) => { seen.push(`${path} ${JSON.stringify(body)}`); return {}; },
    put: async () => ({}), delete: async () => ({}),
  };
  const data = mobilePublicData(api as never);
  await data.market(['MEBL', 'LUCK']);
  await data.companies(['MEBL']);
  await data.requestLookup(['NEWCO']);
  assert.deepEqual(seen, ['/api/public-data?tickers=MEBL%2CLUCK', '/api/companies?tickers=MEBL', '/api/companies {"tickers":["NEWCO"]}']);
});
