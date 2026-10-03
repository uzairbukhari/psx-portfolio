// Wires the shared vault crypto (lib/vault-crypto.ts) to this runtime. Hermes has no WebCrypto, so AES-GCM and
// Argon2id run in pure JS (@noble), and the only native piece is a cryptographically secure random source from
// expo-crypto. A build made before expo-crypto was added does not contain that native module: the app then says
// plainly that this build cannot create or open an encrypted vault, instead of falling back to a weak random
// source. (Math.random is never used for key material.)
import { nobleAes, setCryptoAdapter, type CryptoAdapter } from '../../../lib/vault-crypto.ts';

export type RandomSource = (length: number) => Uint8Array;

/** The adapter for a given secure random source. Pure, so it is testable without native modules. */
export function createMobileAdapter(random: RandomSource): CryptoAdapter {
  return {
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

/** Loads the native random source once and installs the adapter. Safe to call repeatedly. */
export function installMobileCrypto(load: () => RandomSource = defaultRandom): CryptoSetup {
  if (result?.ok) return result;
  try {
    setCryptoAdapter(createMobileAdapter(load()));
    result = { ok: true };
  } catch {
    result = { ok: false, reason: NEEDS_NEW_BUILD };
  }
  return result;
}

/** Test hook: forget the cached outcome. */
export function resetMobileCrypto() {
  result = null;
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
