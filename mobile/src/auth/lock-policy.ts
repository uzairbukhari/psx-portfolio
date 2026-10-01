/** How long the app can sit in the background before it asks for the fingerprint / face again. */
export const LOCK_GRACE_MS = 30_000;

export function shouldLock(backgroundedAt: number | null, now: number, graceMs: number = LOCK_GRACE_MS): boolean {
  if (backgroundedAt === null) return false;
  return now - backgroundedAt >= graceMs;
}
