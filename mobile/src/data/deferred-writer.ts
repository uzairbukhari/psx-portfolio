// Coalesces rapid writes: only the newest value per key is written, off the interaction path.
// `schedule` runs a callback later (the app passes InteractionManager.runAfterInteractions).
export function createDeferredWriter<V>(schedule: (run: () => void) => void, write: (key: string, value: V) => void) {
  const pending = new Map<string, V>();
  let queued = false;
  function enqueue(key: string, value: V) {
    pending.set(key, value);
    if (queued) return;
    queued = true;
    schedule(() => {
      queued = false;
      const batch = [...pending];
      pending.clear();
      for (const [k, v] of batch) {
        try {
          write(k, v);
        } catch {
          // Cache is best effort.
        }
      }
    });
  }
  /** Drops a queued write, e.g. when the user signs out before it ran. */
  enqueue.cancel = (key: string) => void pending.delete(key);
  return enqueue;
}
