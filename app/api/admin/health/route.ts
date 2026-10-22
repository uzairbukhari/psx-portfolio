import { env, waitUntil } from 'cloudflare:workers';
import { adminCached } from '@/lib/admin-cache';
import { adminHealth, spendCaps } from '@/lib/admin-health';
import { platformLimits } from '@/lib/admin-platform';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Operational health for administrators: every data pipeline, queued requests and AI spend. No private data is involved. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const health = await adminCached(req, 'health', () => adminHealth(db(), { ...spendCaps(env), platform: platformLimits(env) }), waitUntil);
    return Response.json(health, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, undefined, req); }
}
