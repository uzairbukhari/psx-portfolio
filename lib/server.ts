import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, isSuperAdmin } from '@/lib/roles';
import { UserError, publicError } from '@/lib/user-error';
export async function identity(req: Request, write = false) {
  const user = await getCurrentUser();
  if (!user) throw new UserError('Sign in to access your portfolio.', 401);
  if (write && req.headers.get('origin') !== new URL(req.url).origin)
    throw new UserError('Invalid request origin.', 403);
  return user.email;
}
export async function requireSuperAdmin(req: Request, write = false) {
  const email = await identity(req, write);
  if (!isSuperAdmin(await getUserRole(email))) throw new UserError('Not authorized.', 403);
  return email;
}
export function db() {
  if (!env.DB) throw new UserError('Portfolio storage is not available.', 503);
  return env.DB;
}
/**
 * Error response for an API route. Only `UserError` messages reach the
 * browser; anything else is logged and answered with a generic message.
 */
export function failure(e: unknown, status?: number) {
  const out = publicError(e, status);
  if (out.status >= 500 && !(e instanceof UserError)) console.error(e);
  return Response.json(
    { error: out.message },
    { status: out.status, headers: { 'Cache-Control': 'no-store' } },
  );
}
