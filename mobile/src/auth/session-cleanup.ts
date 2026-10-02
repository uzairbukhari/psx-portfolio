// Sign-out logic with its side effects injected, so it can be unit tested without native modules.

export type LocalCleanup = {
  /** Email of the account being signed out, used to find its cached portfolio. */
  email: string | null;
  clearToken: () => Promise<unknown>;
  clearProfile: () => Promise<unknown>;
  googleSignOut: () => Promise<unknown>;
  /** Drops every cached query so the next account never paints this one's data. */
  clearQueries: () => void;
  clearPortfolioCache: (email: string) => void;
  clearPushPreference: () => Promise<unknown>;
};

/** Every step runs even if another fails, so one broken store cannot leave data behind. */
export async function clearLocalState(d: LocalCleanup): Promise<void> {
  const steps: (() => unknown)[] = [
    d.clearToken,
    d.clearProfile,
    d.googleSignOut,
    d.clearQueries,
    () => (d.email ? d.clearPortfolioCache(d.email) : undefined),
    d.clearPushPreference,
  ];
  for (const step of steps) {
    try {
      await step();
    } catch {
      // keep going
    }
  }
}

const statusOf = (e: unknown) => (typeof e === 'object' && e !== null && 'status' in e ? Number((e as { status: unknown }).status) : 0);

/** 401/404: the server session is already gone. Anything else the server answered will not improve on retry. */
const retryable = (e: unknown) => {
  const s = statusOf(e);
  return s === 0 || s >= 500;
};

/**
 * Ends the server session for `token`. If the server cannot be reached, the token is queued so the
 * revoke is retried on the next launch (the session otherwise stays live for up to 90 days).
 */
export async function signOutRemote(d: {
  token: string | null;
  revoke: (token: string) => Promise<unknown>;
  queue: (token: string) => Promise<unknown>;
}): Promise<'revoked' | 'queued' | 'none'> {
  if (!d.token) return 'none';
  try {
    await d.revoke(d.token);
    return 'revoked';
  } catch (e) {
    if (!retryable(e)) return 'revoked';
    await d.queue(d.token).catch(() => {});
    return 'queued';
  }
}

/** On launch: finish a queued sign-out. Returns whether one is still pending. */
export async function retryPendingSignOut(d: {
  read: () => Promise<string | null>;
  revoke: (token: string) => Promise<unknown>;
  clear: () => Promise<unknown>;
}): Promise<boolean> {
  const token = await d.read().catch(() => null);
  if (!token) return false;
  try {
    await d.revoke(token);
  } catch (e) {
    if (retryable(e)) return true;
  }
  await d.clear().catch(() => {});
  return false;
}
