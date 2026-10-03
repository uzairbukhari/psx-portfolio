// Ciphertext-only cache on the phone, so the vault can be unlocked offline. It holds the wrappers and the encrypted
// portfolio, never a key, a password or any readable portfolio data, and the file is named by a hash, not the email.
// Older versions kept the readable portfolio here; `purgeLegacyPlaintextCache` removes those files.
import { InteractionManager } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import type { CachedVault, VaultCache } from '../../../lib/vault-client.ts';
import { createDeferredWriter } from '../data/deferred-writer';
import { isLegacyPlaintextCacheName, vaultCacheName } from './cache-name';

const fileFor = (email: string) => new File(Paths.cache, vaultCacheName(email));

const enqueueWrite = createDeferredWriter<CachedVault>(
  (run) => void InteractionManager.runAfterInteractions(run),
  (email, value) => fileFor(email).write(JSON.stringify(value)),
);

export function createFileVaultCache(email: string): VaultCache {
  return {
    async read() {
      try {
        const file = fileFor(email);
        if (!file.exists) return null;
        const data = JSON.parse(await file.text()) as CachedVault;
        return data && typeof data === 'object' && data.vault ? data : null;
      } catch {
        return null;
      }
    },
    write: (value) => enqueueWrite(email, value),
    clear: () => clearVaultCache(email),
  };
}

export function clearVaultCache(email: string): void {
  enqueueWrite.cancel(email);
  try {
    const file = fileFor(email);
    if (file.exists) file.delete();
  } catch {
    // best effort
  }
}

/** Deletes the readable portfolio files older versions left in the cache directory. Returns how many were removed. */
export function purgeLegacyPlaintextCache(): number {
  let removed = 0;
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && isLegacyPlaintextCacheName(entry.name)) {
        try {
          entry.delete();
          removed += 1;
        } catch {
          // keep going; the next launch tries again
        }
      }
    }
  } catch {
    // best effort
  }
  return removed;
}
