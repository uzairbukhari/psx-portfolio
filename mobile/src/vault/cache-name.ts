// Names for the on-device ciphertext cache. The file name is a one-way hash of the account email, so the cache
// directory does not reveal who is signed in, and every name is recognisable so old plaintext files can be purged.
import { sha256 } from '@noble/hashes/sha2.js';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** `vault-<16 hex>.json`: opaque, stable per account, never the email. */
export function vaultCacheName(email: string): string {
  return `vault-${hex(sha256(new TextEncoder().encode(`sipwise-vault-cache/v1|${email.trim().toLowerCase()}`))).slice(0, 16)}.json`;
}

/** Cache files written by versions before encryption held the whole readable portfolio. */
export const isLegacyPlaintextCacheName = (name: string) => /^portfolio-.*\.json$/.test(name);
