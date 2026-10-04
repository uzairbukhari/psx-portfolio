// Client-side vault cryptography shared by the web app and the mobile app. The server never imports this
// for decryption: it only uses `validateEnvelope` / `validateVaultKeyMaterial` to check shapes and limits.
//
// Design (see docs/private-portfolio-encryption-progress.md):
//  - A random 256-bit data key encrypts the whole portfolio with AES-256-GCM (96-bit random nonce, 128-bit tag).
//  - The data key is wrapped twice with AES-256-GCM: by a password key (Argon2id, 64 MiB, t=3, p=1, then HKDF
//    domain separation) and by a separate random 256-bit recovery secret (HKDF domain separation).
//  - Every ciphertext binds its purpose, format version, vault id, key version and (for portfolios) revision
//    through one deterministic AAD string, so wrappers/envelopes cannot be swapped between vaults or revisions.
//  - Primitives: Argon2id, HKDF and SHA-256 from audited @noble/hashes; AES-GCM from WebCrypto where the runtime
//    has it, otherwise @noble/ciphers. Platform randomness is required (no Math.random fallback).
// Pure and runtime-neutral (no Workers, DOM or React Native imports) so Node tests exercise the real code.
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';

export const VAULT_FORMAT_VERSION = 1;
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_ALG = 'A256GCM';
export const KDF_ALG = 'argon2id';
/** Argon2 version 0x13. */
export const KDF_VERSION = 19;
/** Cost the app writes. Memory is in KiB. */
export const KDF_DEFAULT = { m: 65536, t: 3, p: 1 } as const;
/** Anything below the default is a downgrade; anything above these is refused before memory is allocated. */
export const KDF_LIMITS = { mMin: 65536, mMax: 131072, tMin: 3, tMax: 6, p: 1 } as const;

export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const KEY_BYTES = 32;
export const SALT_BYTES = 16;
export const VAULT_ID_BYTES = 16;
export const MIN_PASSWORD_CHARS = 15;
export const MAX_PASSWORD_CHARS = 1024;
/** The existing client-side plaintext portfolio cap is kept. */
export const MAX_PLAINTEXT_BYTES = 4_000_000;
/** Bounded server-side request size: plaintext cap plus base64 and envelope overhead. */
export const MAX_ENCODED_REQUEST_BYTES = 6_000_000;

export type VaultErrorCode =
  | 'weak-password'
  | 'wrong-password'
  | 'wrong-recovery'
  | 'bad-recovery-format'
  | 'tampered'
  | 'unsupported'
  | 'invalid'
  | 'too-large'
  | 'no-random';

/** Error with a stable code, so UIs can say "wrong password" without parsing messages. */
export class VaultError extends Error {
  code: VaultErrorCode;
  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
  }
}

// ---- Encoding -------------------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_LOOKUP: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** base64url without padding. Hand-rolled so the same code runs in Workers, browsers, Node and Hermes. */
export function toB64u(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) out += B64[c & 63];
  }
  return out;
}

export function fromB64u(text: string): Uint8Array {
  if (typeof text !== 'string' || /[^A-Za-z0-9_-]/.test(text) || text.length % 4 === 1)
    throw new VaultError('invalid', 'Invalid encoding.');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = [0, 1, 2, 3].map((k) => (i + k < text.length ? B64_LOOKUP[text[i + k]] : 0));
    out[o++] = (n[0] << 2) | (n[1] >> 4);
    if (i + 2 < text.length) out[o++] = ((n[1] & 15) << 4) | (n[2] >> 2);
    if (i + 3 < text.length) out[o++] = ((n[2] & 3) << 6) | n[3];
  }
  // Reject non-canonical encodings (stray low bits), so one ciphertext has one text form.
  if (toB64u(out) !== text) throw new VaultError('invalid', 'Invalid encoding.');
  return out;
}

/** Length of the base64url text for `bytes` raw bytes. */
export const b64uLength = (bytes: number) => Math.ceil((bytes * 4) / 3);

const utf8 = (text: string) => new TextEncoder().encode(text);

// ---- Runtime adapter ------------------------------------------------------------------------------

export type CryptoAdapter = {
  randomBytes(length: number): Uint8Array;
  aesGcmEncrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
  aesGcmDecrypt(key: Uint8Array, nonce: Uint8Array, aad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>;
};

/** AES-GCM in pure JS (@noble/ciphers). Used where WebCrypto is missing (Hermes) and by interoperability tests. */
export const nobleAes: Pick<CryptoAdapter, 'aesGcmEncrypt' | 'aesGcmDecrypt'> = {
  aesGcmEncrypt: async (key, nonce, aad, plaintext) => gcm(key, nonce, aad).encrypt(plaintext),
  aesGcmDecrypt: async (key, nonce, aad, ciphertext) => gcm(key, nonce, aad).decrypt(ciphertext),
};

/** AES-GCM through WebCrypto (browsers, Workers, Node). */
export function webCryptoAes(subtle: SubtleCrypto): Pick<CryptoAdapter, 'aesGcmEncrypt' | 'aesGcmDecrypt'> {
  const importKey = (key: Uint8Array, usage: 'encrypt' | 'decrypt') =>
    subtle.importKey('raw', key as BufferSource, { name: 'AES-GCM' }, false, [usage]);
  const params = (nonce: Uint8Array, aad: Uint8Array) => ({
    name: 'AES-GCM',
    iv: nonce as BufferSource,
    additionalData: aad as BufferSource,
    tagLength: TAG_BYTES * 8,
  });
  return {
    aesGcmEncrypt: async (key, nonce, aad, plaintext) =>
      new Uint8Array(await subtle.encrypt(params(nonce, aad), await importKey(key, 'encrypt'), plaintext as BufferSource)),
    aesGcmDecrypt: async (key, nonce, aad, ciphertext) =>
      new Uint8Array(await subtle.decrypt(params(nonce, aad), await importKey(key, 'decrypt'), ciphertext as BufferSource)),
  };
}

let adapter: CryptoAdapter | null = null;

/** Mobile calls this once at startup with a native random source (expo-crypto); tests call it to force a path. */
export function setCryptoAdapter(next: CryptoAdapter | null) {
  adapter = next;
}

function defaultAdapter(): CryptoAdapter {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function')
    throw new VaultError('no-random', 'This device has no secure random number source, so encryption cannot be used.');
  return {
    randomBytes: (length) => c.getRandomValues(new Uint8Array(length)),
    ...(c.subtle ? webCryptoAes(c.subtle) : nobleAes),
  };
}

const rt = () => (adapter ??= defaultAdapter());
/** Fresh cryptographic random bytes from the platform source. */
export const randomBytes = (length: number) => rt().randomBytes(length);

// ---- Authenticated metadata -----------------------------------------------------------------------

export type Purpose = 'portfolio' | 'wrap-password' | 'wrap-recovery';

export type PasswordKdf = { alg: typeof KDF_ALG; v: typeof KDF_VERSION; m: number; t: number; p: number };

/**
 * The one deterministic AAD encoding both clients use: `|`-joined ASCII fields. Every field is base64url,
 * decimal or a fixed word, so none can contain the separator.
 */
export function aadFor(
  purpose: Purpose,
  fields: { vaultId: string; keyVersion: number; revision?: number; kdf?: PasswordKdf; salt?: string },
): Uint8Array {
  const parts = ['sipwise-vault', `v${ENVELOPE_VERSION}`, purpose, fields.vaultId, `k${fields.keyVersion}`];
  if (purpose === 'portfolio') parts.push(`r${fields.revision ?? 0}`);
  if (purpose === 'wrap-password') {
    const kdf = fields.kdf;
    if (!kdf || !fields.salt) throw new VaultError('invalid', 'Missing key derivation parameters.');
    parts.push(`${kdf.alg}`, `${kdf.v}`, `m${kdf.m}`, `t${kdf.t}`, `p${kdf.p}`, fields.salt);
  }
  return utf8(parts.join('|'));
}

// ---- Shapes (shared by clients and the server) ----------------------------------------------------

export type PortfolioEnvelope = {
  v: typeof ENVELOPE_VERSION;
  alg: typeof ENVELOPE_ALG;
  vaultId: string;
  keyVersion: number;
  revision: number;
  /** base64url, 12 bytes. */
  nonce: string;
  /** base64url ciphertext including the 16-byte tag. */
  ct: string;
};

export type PasswordWrapper = { kdf: PasswordKdf; salt: string; nonce: string; ct: string };
export type RecoveryWrapper = { nonce: string; ct: string };

/** Everything the server stores about a vault's keys. Only ciphertext and public parameters. */
export type VaultKeyMaterial = {
  vaultId: string;
  formatVersion: typeof VAULT_FORMAT_VERSION;
  keyVersion: number;
  /** Independent concurrency counter for wrapper updates (server-managed). */
  wrapperVersion: number;
  password: PasswordWrapper;
  recovery: RecoveryWrapper;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown, max = 2 ** 31 - 1): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const isB64Len = (v: unknown, bytes: number) => typeof v === 'string' && v.length === b64uLength(bytes) && /^[A-Za-z0-9_-]+$/.test(v);

export const VAULT_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const isVaultId = (v: unknown): v is string => typeof v === 'string' && VAULT_ID_PATTERN.test(v);

/** Checks an Argon2 cost against the limits. Called before any memory is allocated. */
export function assertKdfAllowed(kdf: unknown): asserts kdf is PasswordKdf {
  if (!isObject(kdf) || kdf.alg !== KDF_ALG || kdf.v !== KDF_VERSION)
    throw new VaultError('unsupported', 'Unsupported key derivation settings.');
  const { m, t, p } = kdf;
  if (!isCount(m) || !isCount(t) || !isCount(p)) throw new VaultError('invalid', 'Invalid key derivation settings.');
  if (m < KDF_LIMITS.mMin || t < KDF_LIMITS.tMin || p !== KDF_LIMITS.p)
    throw new VaultError('unsupported', 'Key derivation settings are weaker than this app allows.');
  if (m > KDF_LIMITS.mMax || t > KDF_LIMITS.tMax)
    throw new VaultError('unsupported', 'Key derivation settings are too expensive for this app.');
}

/** Throws unless `value` is a well-formed envelope within the allowlists and the byte limits. Never decrypts. */
export function validateEnvelope(value: unknown, maxCtBytes = MAX_PLAINTEXT_BYTES + TAG_BYTES): asserts value is PortfolioEnvelope {
  if (!isObject(value)) throw new VaultError('invalid', 'Invalid encrypted portfolio.');
  if (value.v !== ENVELOPE_VERSION || value.alg !== ENVELOPE_ALG) throw new VaultError('unsupported', 'Unsupported encrypted portfolio format.');
  if (!isVaultId(value.vaultId) || !isCount(value.keyVersion) || value.keyVersion < 1 || !isCount(value.revision))
    throw new VaultError('invalid', 'Invalid encrypted portfolio.');
  if (!isB64Len(value.nonce, NONCE_BYTES)) throw new VaultError('invalid', 'Invalid encrypted portfolio.');
  const ct = value.ct;
  if (typeof ct !== 'string' || ct.length > b64uLength(maxCtBytes) || ct.length < b64uLength(TAG_BYTES) || !/^[A-Za-z0-9_-]+$/.test(ct) || ct.length % 4 === 1)
    throw new VaultError('invalid', 'Invalid encrypted portfolio.');
  const keys = Object.keys(value);
  if (keys.length !== 7) throw new VaultError('invalid', 'Invalid encrypted portfolio.');
}

/** Same for the key material the server stores. */
export function validateVaultKeyMaterial(value: unknown): asserts value is VaultKeyMaterial {
  if (!isObject(value)) throw new VaultError('invalid', 'Invalid vault.');
  if (value.formatVersion !== VAULT_FORMAT_VERSION) throw new VaultError('unsupported', 'Unsupported vault format.');
  if (!isVaultId(value.vaultId) || !isCount(value.keyVersion) || value.keyVersion < 1 || !isCount(value.wrapperVersion))
    throw new VaultError('invalid', 'Invalid vault.');
  const pw = value.password;
  if (!isObject(pw)) throw new VaultError('invalid', 'Invalid vault.');
  assertKdfAllowed(pw.kdf);
  if (!isB64Len(pw.salt, SALT_BYTES) || !isB64Len(pw.nonce, NONCE_BYTES) || !isB64Len(pw.ct, KEY_BYTES + TAG_BYTES))
    throw new VaultError('invalid', 'Invalid vault.');
  const rec = value.recovery;
  if (!isObject(rec) || !isB64Len(rec.nonce, NONCE_BYTES) || !isB64Len(rec.ct, KEY_BYTES + TAG_BYTES)) throw new VaultError('invalid', 'Invalid vault.');
  if (Object.keys(pw).length !== 4 || Object.keys(rec).length !== 2) throw new VaultError('invalid', 'Invalid vault.');
}

// ---- Password and recovery secret -----------------------------------------------------------------

/** NFKC-normalised, so the same typed password derives the same key on every keyboard and platform. */
export const normalizePassword = (password: string) => password.normalize('NFKC');

export function assertPasswordAcceptable(password: string) {
  const length = [...normalizePassword(password)].length;
  if (length < MIN_PASSWORD_CHARS) throw new VaultError('weak-password', `Use at least ${MIN_PASSWORD_CHARS} characters. A generated passphrase of several random words works well.`);
  if (length > MAX_PASSWORD_CHARS) throw new VaultError('weak-password', `Use at most ${MAX_PASSWORD_CHARS} characters.`);
}

let kdfProgressListener: ((fraction: number) => void) | null = null;

/**
 * Watches the Argon2 derivation in flight (0 to 1) so a screen can show progress; on a phone the pure-JS derivation
 * takes long enough that an unexplained spinner looks like a hang. Returns the unsubscribe function.
 */
export function onKdfProgress(listener: (fraction: number) => void): () => void {
  kdfProgressListener = listener;
  return () => {
    if (kdfProgressListener === listener) kdfProgressListener = null;
  };
}

async function passwordKey(password: string, kdf: PasswordKdf, salt: Uint8Array): Promise<Uint8Array> {
  assertKdfAllowed(kdf);
  const raw = await argon2idAsync(utf8(normalizePassword(password)), salt, {
    m: kdf.m,
    t: kdf.t,
    p: kdf.p,
    dkLen: KEY_BYTES,
    // Validated above; the library caps memory at its own default unless told.
    maxmem: kdf.m * 1024 + 1024 * 1024,
    asyncTick: 25,
    // Looked up per call, so a screen that subscribes just after starting the derivation still hears it.
    onProgress: (fraction) => kdfProgressListener?.(fraction),
  });
  // Domain separation from every other use of the Argon2 output.
  return hkdf(sha256, raw, undefined, utf8('sipwise-vault/v1/password-wrap-key'), KEY_BYTES);
}

const recoveryKey = (secret: Uint8Array) => hkdf(sha256, secret, undefined, utf8('sipwise-vault/v1/recovery-wrap-key'), KEY_BYTES);

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_PREFIX = 'SIPW';
const CHECKSUM_CHARS = 4;

const base32 = (bytes: Uint8Array) => {
  let bits = 0, acc = 0, out = '';
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(acc << (5 - bits)) & 31];
  return out;
};

const unbase32 = (text: string, bytes: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  let bits = 0, acc = 0, o = 0;
  for (const ch of text) {
    const value = CROCKFORD.indexOf(ch);
    if (value < 0) throw new VaultError('bad-recovery-format', 'The recovery key has an invalid character.');
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      if (o < bytes) out[o++] = (acc >> (bits - 8)) & 255;
      bits -= 8;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
};

const checksum = (secret: Uint8Array) => base32(sha256(new Uint8Array([...utf8('sipwise-recovery-checksum/v1'), ...secret]))).slice(0, CHECKSUM_CHARS);

/** `SIPW-XXXX-XXXX-…` (52 secret characters + 4 checksum characters, Crockford base32, groups of four). */
export function encodeRecoverySecret(secret: Uint8Array): string {
  if (secret.length !== KEY_BYTES) throw new VaultError('invalid', 'Invalid recovery secret.');
  const body = base32(secret) + checksum(secret);
  return `${RECOVERY_PREFIX}-${body.match(/.{1,4}/g)!.join('-')}`;
}

/** Parses what a person typed or pasted. Tolerates case, spaces, dashes and the usual I/L/O look-alikes. */
export function decodeRecoverySecret(text: string): Uint8Array {
  let clean = text.toUpperCase().replace(/[\s-]+/g, '');
  if (clean.startsWith(RECOVERY_PREFIX)) clean = clean.slice(RECOVERY_PREFIX.length);
  clean = clean.replace(/O/g, '0').replace(/[IL]/g, '1');
  const secretChars = Math.ceil((KEY_BYTES * 8) / 5);
  if (clean.length !== secretChars + CHECKSUM_CHARS) throw new VaultError('bad-recovery-format', 'The recovery key is the wrong length. Check that all of it was copied.');
  const secret = unbase32(clean.slice(0, secretChars), KEY_BYTES);
  if (checksum(secret) !== clean.slice(secretChars)) throw new VaultError('bad-recovery-format', 'The recovery key has a typing mistake. Check it against your saved copy.');
  return secret;
}

// ---- Key wrapping ---------------------------------------------------------------------------------

async function sealKey(wrapKey: Uint8Array, aad: Uint8Array, dataKey: Uint8Array) {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = await rt().aesGcmEncrypt(wrapKey, nonce, aad, dataKey);
  return { nonce: toB64u(nonce), ct: toB64u(ct) };
}

async function openKey(wrapKey: Uint8Array, aad: Uint8Array, wrapper: { nonce: string; ct: string }, fail: VaultErrorCode) {
  try {
    const key = await rt().aesGcmDecrypt(wrapKey, fromB64u(wrapper.nonce), aad, fromB64u(wrapper.ct));
    if (key.length !== KEY_BYTES) throw new Error('length');
    return key;
  } catch (error) {
    if (error instanceof VaultError && error.code === 'no-random') throw error;
    throw new VaultError(fail, fail === 'wrong-password' ? 'That password is not correct.' : 'That recovery key is not correct.');
  }
}

export async function wrapWithPassword(dataKey: Uint8Array, vaultId: string, keyVersion: number, password: string): Promise<PasswordWrapper> {
  assertPasswordAcceptable(password);
  const kdf: PasswordKdf = { alg: KDF_ALG, v: KDF_VERSION, ...KDF_DEFAULT };
  const salt = toB64u(randomBytes(SALT_BYTES));
  const key = await passwordKey(password, kdf, fromB64u(salt));
  const sealed = await sealKey(key, aadFor('wrap-password', { vaultId, keyVersion, kdf, salt }), dataKey);
  key.fill(0);
  return { kdf, salt, ...sealed };
}

export async function wrapWithRecovery(dataKey: Uint8Array, vaultId: string, keyVersion: number): Promise<{ wrapper: RecoveryWrapper; recoverySecret: string }> {
  const secret = randomBytes(KEY_BYTES);
  const key = recoveryKey(secret);
  const wrapper = await sealKey(key, aadFor('wrap-recovery', { vaultId, keyVersion }), dataKey);
  const recoverySecret = encodeRecoverySecret(secret);
  key.fill(0);
  secret.fill(0);
  return { wrapper, recoverySecret };
}

export async function unwrapWithPassword(material: VaultKeyMaterial, password: string): Promise<Uint8Array> {
  validateVaultKeyMaterial(material);
  const { vaultId, keyVersion, password: w } = material;
  const key = await passwordKey(password, w.kdf, fromB64u(w.salt));
  try {
    return await openKey(key, aadFor('wrap-password', { vaultId, keyVersion, kdf: w.kdf, salt: w.salt }), w, 'wrong-password');
  } finally {
    key.fill(0);
  }
}

export async function unwrapWithRecovery(material: VaultKeyMaterial, recoverySecret: string): Promise<Uint8Array> {
  validateVaultKeyMaterial(material);
  const secret = decodeRecoverySecret(recoverySecret);
  const key = recoveryKey(secret);
  try {
    return await openKey(key, aadFor('wrap-recovery', { vaultId: material.vaultId, keyVersion: material.keyVersion }), material.recovery, 'wrong-recovery');
  } finally {
    key.fill(0);
    secret.fill(0);
  }
}

export type NewVault = {
  /** The usable key. Keep in memory only; never persist or send. */
  dataKey: Uint8Array;
  /** Show once for the person to save; never persist or send. */
  recoverySecret: string;
  material: Omit<VaultKeyMaterial, 'wrapperVersion'> & { wrapperVersion: 0 };
};

/** Generates a new vault: random id and data key, password wrapper, recovery wrapper and recovery secret. */
export async function createVaultKeys(password: string): Promise<NewVault> {
  assertPasswordAcceptable(password);
  const vaultId = toB64u(randomBytes(VAULT_ID_BYTES));
  const keyVersion = 1;
  const dataKey = randomBytes(KEY_BYTES);
  const passwordWrapper = await wrapWithPassword(dataKey, vaultId, keyVersion, password);
  const { wrapper, recoverySecret } = await wrapWithRecovery(dataKey, vaultId, keyVersion);
  return {
    dataKey,
    recoverySecret,
    material: { vaultId, formatVersion: VAULT_FORMAT_VERSION, keyVersion, wrapperVersion: 0, password: passwordWrapper, recovery: wrapper },
  };
}

// ---- Portfolio encryption -------------------------------------------------------------------------

/** Encrypts for `revision` (the revision this ciphertext will be stored at). Plaintext is capped at 4,000,000 bytes. */
export async function encryptPortfolio(dataKey: Uint8Array, vaultId: string, keyVersion: number, revision: number, plaintext: string | Uint8Array): Promise<PortfolioEnvelope> {
  const bytes = typeof plaintext === 'string' ? utf8(plaintext) : plaintext;
  if (bytes.length > MAX_PLAINTEXT_BYTES) throw new VaultError('too-large', 'Portfolio file is too large.');
  const nonce = randomBytes(NONCE_BYTES);
  const ct = await rt().aesGcmEncrypt(dataKey, nonce, aadFor('portfolio', { vaultId, keyVersion, revision }), bytes);
  return { v: ENVELOPE_VERSION, alg: ENVELOPE_ALG, vaultId, keyVersion, revision, nonce: toB64u(nonce), ct: toB64u(ct) };
}

/** Decrypts and authenticates. `expected` pins the vault, key version and the revision the server reported. */
export async function decryptPortfolio(dataKey: Uint8Array, envelope: unknown, expected: { vaultId: string; keyVersion: number; revision: number }): Promise<string> {
  validateEnvelope(envelope);
  if (envelope.vaultId !== expected.vaultId || envelope.keyVersion !== expected.keyVersion || envelope.revision !== expected.revision)
    throw new VaultError('tampered', 'The encrypted portfolio does not match this vault.');
  try {
    const plain = await rt().aesGcmDecrypt(
      dataKey,
      fromB64u(envelope.nonce),
      aadFor('portfolio', { vaultId: envelope.vaultId, keyVersion: envelope.keyVersion, revision: envelope.revision }),
      fromB64u(envelope.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new VaultError('tampered', 'The encrypted portfolio could not be verified. It may be damaged or belong to another vault.');
  }
}
