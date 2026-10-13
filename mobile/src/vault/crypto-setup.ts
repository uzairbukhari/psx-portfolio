// Wires the shared vault crypto (lib/vault-crypto.ts) to this runtime. Hermes has no WebCrypto, so AES-GCM and
// Argon2id run in pure JS (@noble), and the only native piece is a cryptographically secure random source from
// expo-crypto. A build made before expo-crypto was added does not contain that native module: the app then says
// plainly that this build cannot create or open an encrypted vault, instead of falling back to a weak random
// source. (Math.random is never used for key material.)
import { nobleAes, setCryptoAdapter, setKdfAsyncTick, type CryptoAdapter } from '../../../lib/vault-crypto.ts';

export type RandomSource = (length: number) => Uint8Array;
export type NativeKdf = NonNullable<CryptoAdapter['argon2id']>;

/** The adapter for a given secure random source. Pure, so it is testable without native modules. */
export function createMobileAdapter(random: RandomSource, argon2id?: NativeKdf | null): CryptoAdapter {
  return {
    ...(argon2id ? { argon2id } : {}),
    randomBytes: (length) => {
      const bytes = random(length);
      if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new Error('The secure random source returned the wrong amount of data.');
      return bytes;
    },
    ...nobleAes,
  };
}

export type CryptoSetup = { ok: true } | { ok: false; reason: string };

export const NEEDS_NEW_BUILD =
  'This version of the Sipwise app cannot create or open your encrypted vault yet. Install the latest build of the app to continue.';

let result: CryptoSetup | null = null;
let nativeKdf = false;

/** True when the key derivation runs in native code (about a second) instead of pure JS (about a minute). */
export const usesNativeKdf = () => nativeKdf;

/** Loads the native random source once and installs the adapter. Safe to call repeatedly. */
export function installMobileCrypto(load: () => RandomSource = defaultRandom, loadKdf: () => NativeKdf | null = defaultNativeKdf): CryptoSetup {
  if (result?.ok) return result;
  try {
    const random = load();
    let kdf: NativeKdf | null = null;
    try {
      kdf = loadKdf();
    } catch {
      // No native Argon2 in this build: the pure-JS derivation in lib/vault-crypto.ts does the same work, slower.
    }
    nativeKdf = kdf !== null;
    setCryptoAdapter(createMobileAdapter(random, kdf));
    setKdfAsyncTick(100);
    result = { ok: true };
  } catch {
    result = { ok: false, reason: NEEDS_NEW_BUILD };
  }
  return result;
}

/** Test hook: forget the cached outcome. */
export function resetMobileCrypto() {
  result = null;
  nativeKdf = false;
  setCryptoAdapter(null);
}

function defaultRandom(): RandomSource {
  // Loaded lazily and defensively: requiring a missing native module throws, and that must not crash the app.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getRandomBytes } = require('expo-crypto') as typeof import('expo-crypto');
  // Force the native call now so a missing module is detected here, not mid-way through creating a vault.
  const probe = getRandomBytes(16);
  if (!(probe instanceof Uint8Array) || probe.length !== 16) throw new Error('expo-crypto is unavailable.');
  return (length) => getRandomBytes(length);
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));

/** Wraps the native module's hex interface. Exported so the conversion is tested without a phone. */
export function nativeKdfFrom(module: { argon2id(passwordHex: string, saltHex: string, m: number, t: number, p: number, length: number): Promise<string> }): NativeKdf {
  return async (password, salt, cost) => {
    const hex = await module.argon2id(toHex(password), toHex(salt), cost.m, cost.t, cost.p, cost.dkLen);
    if (typeof hex !== 'string' || hex.length !== cost.dkLen * 2 || !/^[0-9a-f]+$/.test(hex)) throw new Error('Native Argon2 returned malformed output.');
    return fromHex(hex);
  };
}

function defaultNativeKdf(): NativeKdf | null {
  // requireOptionalNativeModule returns null (never throws) when this build does not contain the module.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
  const mod = requireOptionalNativeModule<{ argon2id(a: string, b: string, m: number, t: number, p: number, l: number): Promise<string> }>('SipwiseArgon2');
  return mod ? nativeKdfFrom(mod) : null;
}
