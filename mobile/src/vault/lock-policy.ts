/**
 * How long the app may sit in the background before the vault locks and the decrypted portfolio is dropped from
 * memory. It is deliberately longer than the optional biometric lock's grace: the document picker, share sheet and
 * Google flows briefly background the app, and asking for the vault password each time would be unusable. The
 * vault itself is always locked on a cold start (keys live only in memory), whatever this says.
 */
export const VAULT_LOCK_GRACE_MS = 60_000;

export function shouldLockVault(backgroundedAt: number | null, now: number, graceMs: number = VAULT_LOCK_GRACE_MS): boolean {
  return backgroundedAt !== null && now - backgroundedAt >= graceMs;
}

/** The app switcher snapshot is taken as the app leaves the foreground, so the content is covered from that moment. */
export const coversVault = (unlocked: boolean, appActive: boolean) => unlocked && !appActive;
