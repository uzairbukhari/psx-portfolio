import { env, waitUntil } from 'cloudflare:workers';
import { adminCached } from '@/lib/admin-cache';
import { platformLimits, platformReport } from '@/lib/admin-platform';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Super admin: Cloudflare limit meters, platform error counts and server 5xx counts. Numbers only, no user data. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const report = await adminCached(req, 'platform', () => platformReport(db(), platformLimits(env)), waitUntil);
    return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(e, undefined, req); }
}
