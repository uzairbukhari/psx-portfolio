// Opt-in "stay unlocked in this tab". The data key is never stored in the clear: it is encrypted with a
// NON-EXTRACTABLE AES-GCM key kept in IndexedDB (the key bytes cannot be read back by script, only used), and the
// ciphertext sits in sessionStorage, which the browser clears when the tab closes. A reload finds both and reopens
// the vault; locking, inactivity, sign-out and any failure remove them. This defends against stolen storage, not
// against script running in an unlocked page, which is why it is off unless the user asks for it.
export type TabKeepStore = {
  /** sessionStorage-like: cleared by the browser when the tab closes. */
  session: { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
  /** Holds the non-extractable CryptoKey. */
  wrapKey: { get(): Promise<CryptoKey | undefined>; set(key: CryptoKey): Promise<void>; delete(): Promise<void> };
};

const ITEM = 'sipwise-vault-tab-key';
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const aad = (email: string, vaultId: string) => new TextEncoder().encode(`sipwise-tab-keep-v1\n${email.toLowerCase()}\n${vaultId}`);

export async function forgetTabKey(store: TabKeepStore) {
  try { store.session.removeItem(ITEM); } catch { /* storage unavailable */ }
  try { await store.wrapKey.delete(); } catch { /* nothing to delete */ }
}

export function hasTabKey(store: TabKeepStore): boolean {
  try { return store.session.getItem(ITEM) !== null; } catch { return false; }
}

/** Remembers `dataKey` for this tab. Returns false (and stores nothing) if the browser cannot do it safely. */
export async function keepTabKey(store: TabKeepStore, email: string, vaultId: string, dataKey: Uint8Array): Promise<boolean> {
  try {
    await forgetTabKey(store);
    const wrap = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(email, vaultId) }, wrap, new Uint8Array(dataKey)));
    await store.wrapKey.set(wrap);
    store.session.setItem(ITEM, JSON.stringify({ v: 1, email: email.toLowerCase(), vaultId, iv: b64(iv), ct: b64(ct) }));
    return true;
  } catch {
    await forgetTabKey(store);
    return false;
  }
}

/** The remembered data key for this account and vault, or null. Anything unexpected clears the stored copy. */
export async function recallTabKey(store: TabKeepStore, email: string, vaultId: string): Promise<Uint8Array | null> {
  let raw: string | null = null;
  try { raw = store.session.getItem(ITEM); } catch { return null; }
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as { v?: number; email?: string; vaultId?: string; iv?: string; ct?: string };
    const wrap = await store.wrapKey.get();
    if (saved.v !== 1 || saved.email !== email.toLowerCase() || saved.vaultId !== vaultId || !saved.iv || !saved.ct || !wrap) throw new Error('mismatch');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(saved.iv), additionalData: aad(email, vaultId) }, wrap, unb64(saved.ct));
    return new Uint8Array(plain);
  } catch {
    await forgetTabKey(store);
    return null;
  }
}
