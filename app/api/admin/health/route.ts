import { env } from 'cloudflare:workers';
import { adminHealth, spendCaps } from '@/lib/admin-health';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Operational health for administrators: every data pipeline, queued requests and AI spend. No private data is involved. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    return Response.json(await adminHealth(db(), spendCaps(env)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
