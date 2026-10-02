import { env } from 'cloudflare:workers';
import { db, failure, identity } from '@/lib/server';
import { getUserRole, isSuperAdmin } from '@/lib/roles';
import { assertResetAllowed, resetUserData } from '@/lib/staging-reset';

/** Staging only, super admin only: wipes your own portfolio so you can test as a fresh user. */
export async function POST(req: Request) {
  try {
    const email = await identity(req, true);
    const body = (await req.json().catch(() => ({}))) as { confirm?: unknown };
    assertResetAllowed(env.APP_ENV, isSuperAdmin(await getUserRole(email)), body.confirm);
    await resetUserData(db(), email);
    return Response.json({ reset: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
