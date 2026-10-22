import { env, waitUntil } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, isSuperAdmin } from '@/lib/roles';
import { classifyServerError, recordServerError, routeLabel } from '@/lib/server-errors';
import { DB_LIMIT_CODE, UserError, publicError, secondsUntilUtcMidnight } from '@/lib/user-error';
export async function identity(req: Request, write = false) {
  const user = await getCurrentUser();
  if (!user) throw new UserError('Sign in to access your portfolio.', 401);
  // CSRF only applies to ambient cookies; a bearer token is never sent by a browser on its own.
  if (write && user.via !== 'bearer' && req.headers.get('origin') !== new URL(req.url).origin)
    throw new UserError('Invalid request origin.', 403);
  return user.email;
}
export async function requireSuperAdmin(req: Request, write = false) {
  const email = await identity(req, write);
  if (!isSuperAdmin(await getUserRole(email))) throw new UserError('Not authorized.', 403);
  return email;
}
/**
 * The private vault database: ciphertext only. A separate D1 database from `db()`, which holds public market
 * caches and account/operational data. Scrapers and the market Workers have no binding or credential for it.
 */
export function vaultDb() {
  if (!env.VAULT_DB) throw new UserError('Encrypted portfolio storage is not available.', 503);
  return env.VAULT_DB;
}
export function db() {
  if (!env.DB) throw new UserError('Portfolio storage is not available.', 503);
  return env.DB;
}
/**
 * Error response for an API route. Only `UserError` messages reach the
 * browser; anything else is logged and answered with a generic message.
 */
export function failure(e: unknown, status?: number, req?: Request) {
  const out = publicError(e, status);
  if (out.status >= 500 && !(e instanceof UserError)) console.error(e);
  if (out.status >= 500) noteServerError(e, out.status, req);
  return Response.json(
    out.code ? { error: out.message, code: out.code } : { error: out.message },
    { status: out.status, headers: { 'Cache-Control': 'no-store', ...(out.code === DB_LIMIT_CODE ? { 'Retry-After': String(secondsUntilUtcMidnight()) } : {}) } },
  );
}

/** Counts a 5xx per route and code for the admin console. Best effort: a failure here must never change the response. */
function noteServerError(e: unknown, status: number, req?: Request) {
  try {
    if (!env.DB) return;
    const write = recordServerError(env.DB, req ? routeLabel(req.url) : 'unknown', classifyServerError(e, status), status).catch(() => {});
    waitUntil(write);
  } catch { /* never block the answer */ }
}
