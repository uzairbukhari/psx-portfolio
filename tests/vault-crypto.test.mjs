import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import * as v from '../lib/vault-crypto.ts';

const PASSWORD = 'correct horse battery staple';
const subtle = globalThis.crypto.subtle;
const web = { randomBytes: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)), ...v.webCryptoAes(subtle) };
const noble = { randomBytes: web.randomBytes, ...v.nobleAes };
const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (s) => new Uint8Array(Buffer.from(s, 'hex'));

/** Deterministic byte source so the committed vector can be regenerated and compared. */
function seeded(seed) {
  let counter = 0;
  return { ...web, randomBytes: (n) => { const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = (seed * 31 + counter++ * 17 + i * 7) & 255; return out; } };
}

test.afterEach(() => v.setCryptoAdapter(null));

test('Argon2id implementation matches the RFC 9106 test vector', async () => {
  const out = await argon2idAsync(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
    t: 3, m: 32, p: 4, dkLen: 32, key: new Uint8Array(8).fill(3), personalization: new Uint8Array(12).fill(4), maxmem: 2 ** 32 - 1,
  });
  assert.equal(hex(out), '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
});

test('base64url round trips and rejects non-canonical text', () => {
  for (const n of [0, 1, 2, 3, 12, 16, 31, 32, 33]) {
    const bytes = web.randomBytes(n);
    assert.deepEqual(v.fromB64u(v.toB64u(bytes)), bytes);
  }
  assert.throws(() => v.fromB64u('AB=='), /Invalid encoding/);
  assert.throws(() => v.fromB64u('AAAB'.slice(0, 2) + 'B'), /Invalid encoding/);
  assert.throws(() => v.fromB64u('AB'), /Invalid encoding/); // stray low bits
  assert.equal(v.toB64u(new Uint8Array(0)), '');
});

test('vault create, unlock with password, unlock with recovery, portfolio round trip', async () => {
  v.setCryptoAdapter(web);
  const vault = await v.createVaultKeys(PASSWORD);
  assert.match(vault.recoverySecret, /^SIPW(-[0-9A-Z]{4}){14}$/);
  const material = { ...vault.material, wrapperVersion: 1 };
  v.validateVaultKeyMaterial(material);
  assert.deepEqual(await v.unwrapWithPassword(material, PASSWORD), vault.dataKey);
  assert.deepEqual(await v.unwrapWithRecovery(material, vault.recoverySecret), vault.dataKey);
  // Typed with spaces, lower case and look-alikes.
  const typed = vault.recoverySecret.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o');
  assert.deepEqual(await v.unwrapWithRecovery(material, typed), vault.dataKey);
  const env = await v.encryptPortfolio(vault.dataKey, material.vaultId, 1, 1, '{"companies":[],"marker":"SYNTH-ZEBRA-4821"}');
  v.validateEnvelope(env);
  assert.ok(!JSON.stringify(env).includes('ZEBRA'));
  const plain = await v.decryptPortfolio(vault.dataKey, env, { vaultId: material.vaultId, keyVersion: 1, revision: 1 });
  assert.match(plain, /SYNTH-ZEBRA-4821/);
});

test('wrong password, wrong recovery and malformed recovery are distinguished', async () => {
  v.setCryptoAdapter(web);
  const vault = await v.createVaultKeys(PASSWORD);
  const material = { ...vault.material, wrapperVersion: 1 };
  await assert.rejects(v.unwrapWithPassword(material, PASSWORD + 'x'), (e) => e.code === 'wrong-password');
  const other = await v.createVaultKeys(PASSWORD);
  await assert.rejects(v.unwrapWithRecovery(material, other.recoverySecret), (e) => e.code === 'wrong-recovery');
  await assert.rejects(v.unwrapWithRecovery(material, 'SIPW-0000'), (e) => e.code === 'bad-recovery-format');
  const flipped = vault.recoverySecret.replace(/-(.)/, (m, c) => '-' + (c === '1' ? '2' : '1'));
  await assert.rejects(v.unwrapWithRecovery(material, flipped), (e) => e.code === 'bad-recovery-format');
});

test('passwords shorter than 15 characters are refused; NFKC makes composed and decomposed forms equal', async () => {
  v.setCryptoAdapter(web);
  await assert.rejects(v.createVaultKeys('too short'), (e) => e.code === 'weak-password');
  await assert.rejects(v.createVaultKeys('x'.repeat(1025)), (e) => e.code === 'weak-password');
  const composed = 'café café café café';
  const vault = await v.createVaultKeys(composed);
  const key = await v.unwrapWithPassword({ ...vault.material, wrapperVersion: 1 }, composed.normalize('NFD'));
  assert.deepEqual(key, vault.dataKey);
});

test('every encryption uses a fresh nonce and every wrapper a fresh salt', async () => {
  v.setCryptoAdapter(web);
  const key = web.randomBytes(32);
  const a = await v.encryptPortfolio(key, 'AAAAAAAAAAAAAAAAAAAAAA', 1, 1, 'same');
  const b = await v.encryptPortfolio(key, 'AAAAAAAAAAAAAAAAAAAAAA', 1, 1, 'same');
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.ct, b.ct);
  const w1 = await v.wrapWithPassword(key, 'AAAAAAAAAAAAAAAAAAAAAA', 1, PASSWORD);
  const w2 = await v.wrapWithPassword(key, 'AAAAAAAAAAAAAAAAAAAAAA', 1, PASSWORD);
  assert.notEqual(w1.salt, w2.salt);
  assert.notEqual(w1.nonce, w2.nonce);
});

test('altered ciphertext, tag, nonce or metadata fail authentication', async () => {
  v.setCryptoAdapter(web);
  const key = web.randomBytes(32), id = v.toB64u(web.randomBytes(16));
  const env = await v.encryptPortfolio(key, id, 1, 3, 'hello');
  const expected = { vaultId: id, keyVersion: 1, revision: 3 };
  const flip = (text, i) => text.slice(0, i) + (text[i] === 'A' ? 'B' : 'A') + text.slice(i + 1);
  for (const bad of [{ ...env, ct: flip(env.ct, 0) }, { ...env, ct: flip(env.ct, env.ct.length - 2) }, { ...env, nonce: flip(env.nonce, 3) }])
    await assert.rejects(v.decryptPortfolio(key, bad, expected), (e) => e.code === 'tampered');
  // Re-labelled metadata is caught by the pinned expectation and, independently, by the AAD.
  await assert.rejects(v.decryptPortfolio(key, { ...env, revision: 4 }, { ...expected, revision: 4 }), (e) => e.code === 'tampered');
  await assert.rejects(v.decryptPortfolio(key, env, { ...expected, revision: 4 }), (e) => e.code === 'tampered');
  const otherId = v.toB64u(web.randomBytes(16));
  await assert.rejects(v.decryptPortfolio(key, { ...env, vaultId: otherId }, { ...expected, vaultId: otherId }), (e) => e.code === 'tampered');
  await assert.rejects(v.decryptPortfolio(key, { ...env, keyVersion: 2 }, { ...expected, keyVersion: 2 }), (e) => e.code === 'tampered');
  await assert.rejects(v.decryptPortfolio(web.randomBytes(32), env, expected), (e) => e.code === 'tampered');
});

test('wrappers cannot be moved between vaults, key versions, parameters or each other', async () => {
  v.setCryptoAdapter(web);
  const a = await v.createVaultKeys(PASSWORD), b = await v.createVaultKeys(PASSWORD);
  const ma = { ...a.material, wrapperVersion: 1 };
  // Swapping vault id (and so the AAD) breaks both wrappers.
  await assert.rejects(v.unwrapWithPassword({ ...ma, vaultId: b.material.vaultId }, PASSWORD), (e) => e.code === 'wrong-password');
  await assert.rejects(v.unwrapWithRecovery({ ...ma, vaultId: b.material.vaultId }, a.recoverySecret), (e) => e.code === 'wrong-recovery');
  await assert.rejects(v.unwrapWithPassword({ ...ma, keyVersion: 2 }, PASSWORD), (e) => e.code === 'wrong-password');
  // The password wrapper bytes cannot be presented as the recovery wrapper.
  await assert.rejects(v.unwrapWithRecovery({ ...ma, recovery: { nonce: ma.password.nonce, ct: ma.password.ct } }, a.recoverySecret), (e) => e.code === 'wrong-recovery');
  // Changing the (public) salt is detected.
  const salt = ma.password.salt.slice(0, -2) + (ma.password.salt.endsWith('AA') ? 'QQ' : 'AA');
  await assert.rejects(v.unwrapWithPassword({ ...ma, password: { ...ma.password, salt } }, PASSWORD), (e) => e.code === 'wrong-password');
});

test('abusive or unsupported KDF parameters are refused before any key derivation', async () => {
  v.setCryptoAdapter(web);
  const vault = await v.createVaultKeys(PASSWORD);
  const base = { ...vault.material, wrapperVersion: 1 };
  const withKdf = (patch) => ({ ...base, password: { ...base.password, kdf: { ...base.password.kdf, ...patch } } });
  for (const patch of [{ m: 2 ** 31 }, { m: 262144 }, { t: 100 }, { m: 1024 }, { t: 1 }, { p: 4 }, { alg: 'argon2i' }, { v: 16 }, { m: 'big' }, { m: -1 }]) {
    const start = performance.now();
    await assert.rejects(v.unwrapWithPassword(withKdf(patch), PASSWORD), (e) => e instanceof v.VaultError && ['unsupported', 'invalid'].includes(e.code), JSON.stringify(patch));
    assert.ok(performance.now() - start < 200, 'rejected without running Argon2');
  }
  await assert.rejects(v.unwrapWithPassword({ ...base, formatVersion: 2 }, PASSWORD), (e) => e.code === 'unsupported');
});

test('envelope and key-material validation enforces shape, lengths and allowlists', async () => {
  const id = v.toB64u(web.randomBytes(16));
  const good = { v: 1, alg: 'A256GCM', vaultId: id, keyVersion: 1, revision: 1, nonce: v.toB64u(web.randomBytes(12)), ct: v.toB64u(web.randomBytes(40)) };
  v.validateEnvelope(good);
  for (const patch of [{ v: 2 }, { alg: 'A128GCM' }, { vaultId: 'short' }, { keyVersion: 0 }, { revision: -1 }, { nonce: v.toB64u(web.randomBytes(11)) }, { ct: 'AAAA' }, { ct: 'a b' }, { extra: 1 }, { ct: 'A'.repeat(6_000_000) }])
    assert.throws(() => v.validateEnvelope({ ...good, ...patch }), v.VaultError, JSON.stringify(patch).slice(0, 60));
  assert.throws(() => v.validateEnvelope(null), v.VaultError);
  assert.throws(() => v.validateEnvelope([]), v.VaultError);
});

test('plaintext over 4,000,000 bytes is refused client-side', async () => {
  v.setCryptoAdapter(web);
  await assert.rejects(v.encryptPortfolio(web.randomBytes(32), 'AAAAAAAAAAAAAAAAAAAAAA', 1, 1, new Uint8Array(4_000_001)), (e) => e.code === 'too-large');
  const env = await v.encryptPortfolio(web.randomBytes(32), 'AAAAAAAAAAAAAAAAAAAAAA', 1, 1, new Uint8Array(4_000_000));
  assert.ok(JSON.stringify(env).length < v.MAX_ENCODED_REQUEST_BYTES);
});

test('no secure random source means encryption refuses to run', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    v.setCryptoAdapter(null);
    await assert.rejects(v.createVaultKeys(PASSWORD), (e) => e.code === 'no-random');
  } finally {
    Object.defineProperty(globalThis, 'crypto', original);
  }
});

test('WebCrypto and pure-JS AES-GCM interoperate in both directions (the browser and Hermes paths)', async () => {
  const key = web.randomBytes(32), nonce = web.randomBytes(12), aad = new TextEncoder().encode('aad'), plain = new Uint8Array(100_000).map((_, i) => (i * 13) & 255);
  const a = await web.aesGcmEncrypt(key, nonce, aad, plain), b = await noble.aesGcmEncrypt(key, nonce, aad, plain);
  assert.equal(hex(a), hex(b));
  assert.deepEqual(await noble.aesGcmDecrypt(key, nonce, aad, a), plain);
  assert.deepEqual(await web.aesGcmDecrypt(key, nonce, aad, b), plain);
  // A vault written through one adapter opens through the other.
  v.setCryptoAdapter(web);
  const vault = await v.createVaultKeys(PASSWORD);
  const env = await v.encryptPortfolio(vault.dataKey, vault.material.vaultId, 1, 1, 'cross');
  v.setCryptoAdapter(noble);
  assert.deepEqual(await v.unwrapWithPassword({ ...vault.material, wrapperVersion: 1 }, PASSWORD), vault.dataKey);
  assert.equal(await v.decryptPortfolio(vault.dataKey, env, { vaultId: vault.material.vaultId, keyVersion: 1, revision: 1 }), 'cross');
});

test('committed test vector: a fixed vault decrypts, and regenerating it is byte-identical', async () => {
  const path = new URL('./fixtures/vault-vector.json', import.meta.url);
  v.setCryptoAdapter(seeded(5));
  const vault = await v.createVaultKeys('vector passphrase for interop');
  const env = await v.encryptPortfolio(vault.dataKey, vault.material.vaultId, 1, 7, '{"synthetic":"portfolio","n":1}');
  const generated = { password: 'vector passphrase for interop', recoverySecret: vault.recoverySecret, dataKeyHex: hex(vault.dataKey), material: { ...vault.material, wrapperVersion: 1 }, envelope: env, plaintext: '{"synthetic":"portfolio","n":1}' };
  if (!existsSync(path)) writeFileSync(path, JSON.stringify(generated, null, 2) + '\n');
  const fixture = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(generated, fixture, 'the on-wire format changed: bump the version instead of editing the vector');
  for (const adapter of [web, noble]) {
    v.setCryptoAdapter(adapter);
    assert.equal(hex(await v.unwrapWithPassword(fixture.material, fixture.password)), fixture.dataKeyHex);
    assert.equal(hex(await v.unwrapWithRecovery(fixture.material, fixture.recoverySecret)), fixture.dataKeyHex);
    assert.equal(await v.decryptPortfolio(unhex(fixture.dataKeyHex), fixture.envelope, { vaultId: fixture.material.vaultId, keyVersion: 1, revision: 7 }), fixture.plaintext);
  }
});

test('one Argon2id derivation stays within the runtime budget on this machine', async () => {
  v.setCryptoAdapter(web);
  const start = performance.now();
  await v.wrapWithPassword(web.randomBytes(32), 'AAAAAAAAAAAAAAAAAAAAAA', 1, PASSWORD);
  const ms = performance.now() - start;
  console.log(`# argon2id 64MiB t=3 p=1: ${ms.toFixed(0)} ms (Node ${process.version})`);
  assert.ok(ms < 15_000);
});

test('onKdfProgress reports the Argon2 derivation and unsubscribes cleanly', async () => {
  v.setCryptoAdapter(web);
  const vault = await v.createVaultKeys(PASSWORD);
  const material = { ...vault.material, wrapperVersion: 1 };
  const seen = [];
  const stop = v.onKdfProgress((f) => seen.push(f));
  await v.unwrapWithPassword(material, PASSWORD);
  stop();
  assert.ok(seen.length > 1, 'progress is reported while deriving');
  assert.ok(seen.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= seen[i - 1])), 'values rise from 0 to 1');
  assert.equal(seen.at(-1), 1);
  const before = seen.length;
  await v.unwrapWithPassword(material, PASSWORD);
  assert.equal(seen.length, before, 'no reports after unsubscribing');
});
