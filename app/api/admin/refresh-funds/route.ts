import { refreshPlanNavs } from '@/lib/plan-navs';
import { refreshFunds } from '@/lib/mufap-refresh';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Super admin: fetch MUFAP's fund list and prices now (the cron Worker does this daily). */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin(req, true);
    const funds = await refreshFunds(db());
    const plans = await refreshPlanNavs(db());
    return Response.json(
      { funds, plans },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
