import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
import { getUserRole, isSuperAdmin } from '@/lib/roles';
export async function identity(req: Request, write = false) {
  const user = await getCurrentUser();
  if (!user) throw Error('Sign in to access your portfolio.');
  if (write && req.headers.get('origin') !== new URL(req.url).origin)
    throw Error('Invalid request origin.');
  return user.email;
}
export async function requireSuperAdmin(req: Request, write = false) {
  const email = await identity(req, write);
  if (!isSuperAdmin(await getUserRole(email))) throw Error('Not authorized.');
  return email;
}
export function db() {
  if (!env.DB) throw Error('Portfolio storage is not available.');
  return env.DB;
}
export function failure(e: unknown, status = 400) {
  if (e instanceof Error && e.message === 'Sign in to access your portfolio.')
    status = 401;
  if (e instanceof Error && e.message === 'Invalid request origin.')
    status = 403;
  if (e instanceof Error && e.message === 'Not authorized.') status = 403;
  return Response.json(
    { error: e instanceof Error ? e.message : 'Request failed' },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
