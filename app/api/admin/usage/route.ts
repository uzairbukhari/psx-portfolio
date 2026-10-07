import { usageReport } from '@/lib/analytics-store';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Usage analytics for the super admin: counts of sign-ups, active users and feature use. No private data exists here. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const includeAdmin = new URL(req.url).searchParams.get('admin') === '1';
    return Response.json(await usageReport(db(), includeAdmin), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
