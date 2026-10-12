import { refreshPlanNavs } from '@/lib/plan-navs';
import { refreshFundPayouts, refreshFunds } from '@/lib/mufap-refresh';
import { recordJobRun } from '@/lib/job-runs';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Super admin: fetch MUFAP's fund list and prices now (the cron Worker does this daily). Logged as an admin action and a job run. */
export async function POST(req: Request) {
  const startedAt = new Date().toISOString();
  let actor = '';
  try {
    actor = await requireSuperAdmin(req, true);
    const funds = await refreshFunds(db());
    const payouts = await refreshFundPayouts(db()).catch((e: unknown) => ({
      error: e instanceof Error ? e.message : 'Payout refresh failed.',
    }));
    const plans = await refreshPlanNavs(db());
    await recordJobRun(db(), { job: 'funds', source: 'admin', startedAt, ok: true, detail: `${funds.funds} funds, ${funds.prices} prices` }).catch(() => {});
    await db().prepare('INSERT INTO admin_actions (at,actor,action,target,result) VALUES (?,?,?,?,?)')
      .bind(new Date().toISOString(), actor, 'refresh-funds', 'mufap', 'ok').run().catch(() => {});
    return Response.json(
      { funds, payouts, plans },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (actor) {
      await recordJobRun(db(), { job: 'funds', source: 'admin', startedAt, ok: false, detail: e }).catch(() => {});
      await db().prepare('INSERT INTO admin_actions (at,actor,action,target,result) VALUES (?,?,?,?,?)')
        .bind(new Date().toISOString(), actor, 'refresh-funds', 'mufap', 'failed').run().catch(() => {});
    }
    return failure(e);
  }
}
