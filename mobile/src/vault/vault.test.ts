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

test('biometric key: saved behind the biometric, recalled, forgotten, and never stored when unavailable', async () => {
  const { biometricKeyName, saveBiometricKey, recallBiometricKey, hasBiometricKey, forgetBiometricKey } = await import('./biometric-key.ts');
  const items = new Map<string, string>();
  let available = true;
  const store = {
    available: () => available,
    getMarker: async (n: string) => items.get(n) ?? null,
    setMarker: async (n: string, v: string) => void items.set(n, v),
    setSecret: async (n: string, v: string) => void items.set(n, v),
    getSecret: async (n: string) => items.get(n) ?? null,
    remove: async (n: string) => void items.delete(n),
  };
  const key = nodeRandom(32);
  assert.match(biometricKeyName('Me@Example.com'), /^sipwise\.vaultkey\.[0-9a-f]{16}$/);
  assert.equal(biometricKeyName('Me@Example.com'), biometricKeyName(' me@example.com '));
  assert.ok(![...items.keys()].some((k) => k.includes('example')));
  available = false;
  assert.equal(await saveBiometricKey(store, 'me@example.com', 'vault-1', key), false);
  assert.equal(items.size, 0, 'nothing is stored when the phone cannot bind a key to the biometric');
  available = true;
  assert.equal(await hasBiometricKey(store, 'me@example.com', 'vault-1'), false);
  assert.equal(await saveBiometricKey(store, 'me@example.com', 'vault-1', key), true);
  assert.equal(await hasBiometricKey(store, 'me@example.com', 'vault-1'), true);
  assert.deepEqual(await recallBiometricKey(store, 'me@example.com', 'vault-1'), key);
  assert.equal(await recallBiometricKey(store, 'me@example.com', 'vault-2'), null, 'a key for another vault is not offered');
  assert.equal(await recallBiometricKey(store, 'other@example.com', 'vault-1'), null, 'another account has no key');
  await forgetBiometricKey(store, 'me@example.com');
  assert.equal(items.size, 0);
  assert.equal(await recallBiometricKey(store, 'me@example.com', 'vault-1'), null);
});

test('biometric key: a cancelled prompt or a failing store yields null, a wrong-length key is rejected', async () => {
  const { saveBiometricKey, recallBiometricKey } = await import('./biometric-key.ts');
  const items = new Map<string, string>();
  let failRead = false;
  const store = {
    available: () => true,
    getMarker: async (n: string) => items.get(n) ?? null,
    setMarker: async (n: string, v: string) => void items.set(n, v),
    setSecret: async (n: string, v: string) => void items.set(n, v),
    getSecret: async (n: string) => { if (failRead) throw new Error('user cancelled'); return items.get(n) ?? null; },
    remove: async (n: string) => void items.delete(n),
  };
  await saveBiometricKey(store, 'me@example.com', 'v', nodeRandom(32));
  failRead = true;
  assert.equal(await recallBiometricKey(store, 'me@example.com', 'v'), null);
  failRead = false;
  await saveBiometricKey(store, 'me@example.com', 'v', nodeRandom(16));
  assert.equal(await recallBiometricKey(store, 'me@example.com', 'v'), null);
  const broken = { ...store, setSecret: async () => { throw new Error('keystore unavailable'); } };
  assert.equal(await saveBiometricKey(broken, 'me@example.com', 'v', nodeRandom(32)), false);
  assert.equal(items.size, 0, 'a failed save leaves no marker behind');
});
