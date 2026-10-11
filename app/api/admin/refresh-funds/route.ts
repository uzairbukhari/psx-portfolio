import { refreshPlanNavs } from '@/lib/plan-navs';
import { refreshFundPayouts, refreshFunds } from '@/lib/mufap-refresh';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Super admin: fetch MUFAP's fund list and prices now (the cron Worker does this daily). */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin(req, true);
    const funds = await refreshFunds(db());
    const payouts = await refreshFundPayouts(db()).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : 'Payout refresh failed.',
    }));
    const plans = await refreshPlanNavs(db());
    return Response.json(
      { funds, payouts, plans },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
