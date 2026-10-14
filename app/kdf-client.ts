// Main-thread side of kdf.worker.ts, registered with lib/vault-crypto.ts#setKdfRunner. Where module workers are
// not available (older WebViews) it falls back to the in-thread path the phone uses.
import { argon2idAsync } from '@noble/hashes/argon2.js';

type Params = { m: number; t: number; p: number; dkLen: number };
type Reply = { id: number; key?: Uint8Array; progress?: number; error?: string };
type Job = { resolve: (key: Uint8Array) => void; reject: (error: Error) => void; onProgress: (fraction: number) => void };

let worker: Worker | null | undefined;
let sequence = 0;
const jobs = new Map<number, Job>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const created = new Worker(new URL('./kdf.worker.ts', import.meta.url), { type: 'module' });
    created.onmessage = (e: MessageEvent<Reply>) => {
      const job = jobs.get(e.data.id);
      if (!job) return;
      if (e.data.progress !== undefined) return job.onProgress(e.data.progress);
      jobs.delete(e.data.id);
      if (e.data.key) job.resolve(e.data.key);
      else job.reject(new Error(e.data.error ?? 'Key derivation failed.'));
    };
    created.onerror = () => {
      // The worker could not start: fail what is waiting, and use the in-thread path from now on.
      worker = null;
      for (const job of jobs.values()) job.reject(new Error('Key derivation failed. Reload and try again.'));
      jobs.clear();
    };
    worker = created;
  } catch {
    worker = null;
  }
  return worker;
}

export function deriveKey(
  password: Uint8Array,
  salt: Uint8Array,
  params: Params,
  onProgress: (fraction: number) => void,
): Promise<Uint8Array> {
  const w = typeof Worker === 'undefined' ? null : getWorker();
  if (!w)
    return argon2idAsync(password, salt, {
      ...params,
      maxmem: params.m * 1024 + 1024 * 1024,
      asyncTick: 25,
      onProgress,
    });
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress });
    // Copies, not transfers: the caller keeps (and zeroes) its own buffers.
    w.postMessage({ id, password: password.slice(), salt: salt.slice(), ...params });
  });
}
