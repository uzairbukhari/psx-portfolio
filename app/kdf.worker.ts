// Runs Argon2id off the main thread: same @noble/hashes primitive and parameters as lib/vault-crypto.ts, only the
// thread differs, so the page stays responsive (progress bar, typing, scrolling) while the key is derived.
import { argon2id } from '@noble/hashes/argon2.js';

type Request = { id: number; password: Uint8Array; salt: Uint8Array; m: number; t: number; p: number; dkLen: number };
const post = (message: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, password, salt, m, t, p, dkLen } = e.data;
  try {
    let last = 0;
    const key = argon2id(password, salt, {
      m,
      t,
      p,
      dkLen,
      maxmem: m * 1024 + 1024 * 1024,
      onProgress: (fraction) => {
        if (fraction - last >= 0.02 || fraction === 1) {
          last = fraction;
          post({ id, progress: fraction });
        }
      },
    });
    password.fill(0);
    post({ id, key }, [key.buffer]);
  } catch (error) {
    password.fill(0);
    post({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
