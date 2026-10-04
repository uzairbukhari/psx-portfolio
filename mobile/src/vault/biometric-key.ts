// Fingerprint / face unlock for the vault. After one successful password unlock (and only if the user opts in), the
// vault's data key is stored in the phone's secure store, bound to the biometric so every read needs a fingerprint or
// face. The vault password stays the fallback and the only way to set up; locking the app keeps the key, signing out,
// erasing the vault or a failed decrypt removes it. The storage is injected so the rules can be tested without native modules.
import { sha256 } from '@noble/hashes/sha2.js';

export type BiometricKeyStore = {
  /** Whether this phone has an enrolled biometric the secure store can bind a key to. */
  available(): boolean;
  /** Plain (ungated) marker that a key exists, so the unlock screen can offer the button without a prompt. */
  getMarker(name: string): Promise<string | null>;
  setMarker(name: string, value: string): Promise<void>;
  /** The gated key itself. Reading shows the system fingerprint / face prompt; null when cancelled or invalidated. */
  setSecret(name: string, value: string, prompt: string): Promise<void>;
  getSecret(name: string, prompt: string): Promise<string | null>;
  remove(name: string): Promise<void>;
};

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Secure-store names allow only letters, digits, `.`, `-` and `_`; the hash keeps the email out of them. */
export const biometricKeyName = (email: string) =>
  `sipwise.vaultkey.${hex(sha256(new TextEncoder().encode(`sipwise-biometric-key/v1|${email.trim().toLowerCase()}`))).slice(0, 16)}`;

const markerName = (name: string) => `${name}.on`;

export async function forgetBiometricKey(store: BiometricKeyStore, email: string): Promise<void> {
  const name = biometricKeyName(email);
  for (const item of [markerName(name), name]) {
    try { await store.remove(item); } catch { /* nothing stored */ }
  }
}

/** Whether a key is stored for this account's current vault (no prompt). */
export async function hasBiometricKey(store: BiometricKeyStore, email: string, vaultId: string): Promise<boolean> {
  try {
    return (await store.getMarker(markerName(biometricKeyName(email)))) === vaultId;
  } catch {
    return false;
  }
}

/** Stores `dataKey` behind the biometric. Returns false, storing nothing, when the phone cannot do it. */
export async function saveBiometricKey(store: BiometricKeyStore, email: string, vaultId: string, dataKey: Uint8Array): Promise<boolean> {
  if (!store.available()) return false;
  const name = biometricKeyName(email);
  try {
    await forgetBiometricKey(store, email);
    await store.setSecret(name, b64(dataKey), 'Turn on fingerprint unlock');
    await store.setMarker(markerName(name), vaultId);
    return true;
  } catch {
    await forgetBiometricKey(store, email);
    return false;
  }
}

/** Asks for the biometric and returns the data key, or null (cancelled, changed biometrics, nothing stored). */
export async function recallBiometricKey(store: BiometricKeyStore, email: string, vaultId: string): Promise<Uint8Array | null> {
  if (!(await hasBiometricKey(store, email, vaultId))) return null;
  try {
    const raw = await store.getSecret(biometricKeyName(email), 'Unlock Sipwise');
    if (!raw) return null;
    const key = unb64(raw);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}
