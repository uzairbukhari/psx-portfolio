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

export function publicError(e: unknown, status?: number) {
  if (e instanceof UserError)
    return { message: e.message, status: status ?? e.status, code: e.code };
  if (e instanceof SyntaxError)
    return { message: 'Invalid request body.', status: 400, code: undefined };
  return { message: GENERIC_ERROR, status: 500, code: undefined };
}
