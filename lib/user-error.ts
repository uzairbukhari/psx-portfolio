/**
 * An error whose message is written for the user and safe to return from an
 * API route. Anything else (D1, fetch, runtime failures) is logged and answered
 * with a generic message so internals never leak to the browser.
 */
export class UserError extends Error {
  status: number;
  /** Optional machine-readable reason clients can switch on (e.g. 'upgrade-required'). */
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = 'UserError';
    this.status = status;
    if (code) this.code = code;
  }
}

export const GENERIC_ERROR = 'Something went wrong. Try again.';

/**
 * Cloudflare answers every D1 call with this once the account has used its free daily rows (code 7500) until 00:00 UTC.
 * It is not a bug, and every route would otherwise say "Something went wrong": say what happened and when it ends, and
 * give clients a code to switch on (the vault then opens read-only from the copy kept on the device).
 */
export const DB_LIMIT_CODE = 'db-limit';
export const DB_LIMIT_MESSAGE = "Today's free database allowance is used up, so Sipwise is read-only until 00:00 UTC (05:00 in Pakistan). Your data is safe.";
export const isDbLimit = (e: unknown) =>
  /exceeded D1's free tier|free tier daily row (read|write) limit|\b7500\b.*D1|D1.*\b7500\b/i.test(e instanceof Error ? e.message : typeof e === 'string' ? e : '');

/** Seconds until the next 00:00 UTC, when Cloudflare resets the free allowance. */
export const secondsUntilUtcMidnight = (now = new Date()) =>
  Math.max(60, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000));

export function publicError(e: unknown, status?: number) {
  if (isDbLimit(e)) return { message: DB_LIMIT_MESSAGE, status: 503, code: DB_LIMIT_CODE };
  if (e instanceof UserError)
    return { message: e.message, status: status ?? e.status, ...(e.code ? { code: e.code } : {}) };
  if (e instanceof SyntaxError) return { message: 'Invalid request body.', status: 400 };
  return { message: GENERIC_ERROR, status: 500 };
}
