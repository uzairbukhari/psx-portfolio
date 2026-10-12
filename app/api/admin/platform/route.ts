import { env } from 'cloudflare:workers';
import { platformLimits, platformReport } from '@/lib/admin-platform';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Super admin: Cloudflare limit meters, platform error counts and server 5xx counts. Numbers only, no user data. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    return Response.json(await platformReport(db(), platformLimits(env)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(e, undefined, req); }
}
