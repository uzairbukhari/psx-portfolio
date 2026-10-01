/** How long the app can sit in the background before it asks for the fingerprint / face again. */
export const LOCK_GRACE_MS = 30_000;

export function shouldLock(backgroundedAt: number | null, now: number, graceMs: number = LOCK_GRACE_MS): boolean {
  if (backgroundedAt === null) return false;
  return now - backgroundedAt >= graceMs;
}

/** The app switcher snapshot is taken when the app leaves the foreground, so hide the content from that moment. */
export const coversContent = (enabled: boolean, locked: boolean, appActive: boolean) => enabled && (locked || !appActive);
