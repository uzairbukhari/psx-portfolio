// Browser backing for lib/vault-tab-keep.ts: sessionStorage for the ciphertext, IndexedDB for the non-extractable key.
import type { TabKeepStore } from '@/lib/vault-tab-keep';

const DB = 'sipwise-vault-tab';
const STORE = 'keys';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Built on demand: sessionStorage and IndexedDB exist only in the browser. */
export const browserTabKeepStore = (): TabKeepStore => ({
  session: window.sessionStorage,
  wrapKey: {
    get: () => run('readonly', (store) => store.get('wrap') as IDBRequest<CryptoKey | undefined>),
    set: async (key) => void (await run('readwrite', (store) => store.put(key, 'wrap'))),
    delete: async () => void (await run('readwrite', (store) => store.delete('wrap'))),
  },
});
