import { env, waitUntil } from 'cloudflare:workers';
import { adminCached } from '@/lib/admin-cache';
import { adminHealth, spendCaps } from '@/lib/admin-health';
import { buildAttention } from '@/lib/admin-overview';
import { overviewMetrics } from '@/lib/analytics-store';
import { internalUserKeys } from '@/lib/internal-accounts';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** The admin Overview: pipeline status strip, KPIs, what needs attention. Counts and statuses only, no private data. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const database = db();
    const includeAdmin = new URL(req.url).searchParams.get('admin') === '1';
    const body = await adminCached(req, `overview:${includeAdmin ? 1 : 0}`, async () => {
      const keys = includeAdmin ? [] : await internalUserKeys(database, env.SESSION_SECRET ?? '');
      const [health, metrics] = await Promise.all([adminHealth(database, spendCaps(env)), overviewMetrics(database, includeAdmin, new Date(), keys)]);
      return { health, metrics, attention: buildAttention(health, metrics) };
    }, waitUntil);
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, undefined, req); }
}
