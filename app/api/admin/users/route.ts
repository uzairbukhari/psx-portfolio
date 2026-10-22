import { env, waitUntil } from 'cloudflare:workers';
import { adminCached } from '@/lib/admin-cache';
import { userDirectory } from '@/lib/admin-users-store';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** The People directory for the super admin: every account with its furthest step and follow-up lists. Activity only, never portfolio data. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const includeInternal = new URL(req.url).searchParams.get('admin') === '1';
    const directory = await adminCached(req, `users:${includeInternal ? 1 : 0}`, () => userDirectory(db(), env.SESSION_SECRET ?? '', includeInternal), waitUntil);
    return Response.json(directory, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, undefined, req); }
}
