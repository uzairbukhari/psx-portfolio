import { env } from 'cloudflare:workers';
import { internalUserKeys } from '@/lib/internal-accounts';
import { usageReport } from '@/lib/analytics-store';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Usage analytics for the super admin: counts of sign-ups, active users and feature use. No private data exists here. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const q = new URL(req.url).searchParams;
    const includeAdmin = q.get('admin') === '1';
    const days = Number(q.get('days') ?? 30);
    const database = db();
    const keys = includeAdmin ? [] : await internalUserKeys(database, env.SESSION_SECRET ?? '');
    return Response.json(await usageReport(database, includeAdmin, new Date(), keys, days), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
