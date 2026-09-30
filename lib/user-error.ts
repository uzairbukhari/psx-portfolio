/**
 * An error whose message is written for the user and safe to return from an
 * API route. Anything else (D1, fetch, runtime failures) is logged and answered
 * with a generic message so internals never leak to the browser.
 */
export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'UserError';
    this.status = status;
  }
}

export const GENERIC_ERROR = 'Something went wrong. Try again.';

export function publicError(e: unknown, status?: number) {
  if (e instanceof UserError)
    return { message: e.message, status: status ?? e.status };
  if (e instanceof SyntaxError)
    return { message: 'Invalid request body.', status: 400 };
  return { message: GENERIC_ERROR, status: 500 };
}
