import { refreshPlanNavs } from '../../../lib/plan-navs';
import { sendAdminAlerts } from '../../../lib/admin-alerts';
import { syncPlatformMetrics } from '../../../lib/cf-analytics';
import { recordJobRun } from '../../../lib/job-runs';
import { PIPELINES } from '../../../lib/pipelines';
import { isBrownout, syncD1Usage } from '../../../lib/d1-usage';
import { dispatchWorkflow, dueWorkflows, isFundRefreshTime, isPlatformTime } from '../../../lib/scrape-schedule';

// This Worker has no VAULT_DB binding and no way to learn what any user holds: it only starts public scrapers.
interface Env {
  DB: D1Database;
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPO?: string;
  APP_ENV?: string;
  /** Optional: a read-only Account Analytics token, and the account id, switch on Cloudflare limit tracking in the admin console. */
  AI_RESEARCH_MONTHLY_CAP_USD?: string;
  FACE_VALUE_AI_MONTHLY_CAP_USD?: string;
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  /** Optional: Firebase service account JSON; switches on push to the native Android app. */
  FCM_SERVICE_ACCOUNT_JSON?: string;
}

/**
 * PSX refuses Cloudflare's network, so this Worker never fetches prices. It starts the GitHub Actions scrapers
 * (quotes every 5 minutes, history every 15, plus the post-close run) on time, because GitHub's own `schedule:`
 * triggers run hours late or are dropped. The workflows keep their GitHub cron as a fallback.
 */
async function startDueScrapers(env: Env, scheduledTime: number) {
  const due = dueWorkflows(new Date(scheduledTime), await isBrownout(env.DB, new Date(scheduledTime)));
  const settings = {
    token: env.GITHUB_DISPATCH_TOKEN,
    repo: env.GITHUB_REPO,
    appEnv: env.APP_ENV,
  };
  for (const { workflow, reason } of due) {
    const error = await dispatchWorkflow(settings, workflow);
    if (error) {
      console.error(`Could not start ${workflow} (${reason}): ${error}`);
      // A scraper that never started leaves no run of its own, so the failure is recorded here for the admin console.
      const job = PIPELINES.find((p) => p.workflow === workflow)?.id;
      if (job && env.APP_ENV !== 'staging')
        await recordJobRun(env.DB, { job, source: 'cron', startedAt: new Date().toISOString(), ok: false, detail: `Could not start ${workflow}: ${error}` }).catch(() => {});
    } else console.log(`Started ${workflow} (${reason}).`);
  }
}

// Pak-Qatar plan prices are read at the nightly time (22:30 PKT) and again mid-morning and mid-afternoon.
// There is a single Cron Trigger (every 5 minutes; the free plan allows 5 per account), so each firing checks what is due by time.

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    // Proof the cron itself is firing, shown in the admin console (one row, overwritten each tick).
    const beat = new Date(controller.scheduledTime).toISOString();
    ctx.waitUntil(
      env.DB.prepare(
        `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,failure_count) VALUES ('cron','heartbeat',?,?,0)
         ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at`,
      ).bind(beat, beat).run().catch(() => {}),
    );
    // Twice an hour, every day, after copying Cloudflare's own request, error and limit numbers for the two Workers (needs the
    // optional token), tell super admins' phones (generic message, once a day per issue) if anything is wrong. It runs outside market
    // hours and at weekends too.
    const when = new Date(controller.scheduledTime);
    if (isPlatformTime(when)) {
      if (env.APP_ENV !== 'staging') ctx.waitUntil(
        (async () => {
          // The outcome is a job run, so the Platform page can say why the numbers are missing (wrong token, account id, ...).
          const startedAt = new Date().toISOString();
          const sync = await syncPlatformMetrics(env.DB, { token: env.CF_ANALYTICS_TOKEN, accountId: env.CF_ACCOUNT_ID }, ['psx-portfolio-sip', 'psx-portfolio-sip-quote-refresh'], new Date(controller.scheduledTime)).catch((e: unknown) => ({ stored: 0, error: e instanceof Error ? e.message : 'sync failed' }));
          await recordJobRun(env.DB, { job: 'platform', source: 'cron', startedAt, ok: !sync.error, detail: sync.error ?? `${sync.stored} Workers` }).catch(() => {});
          // D1 rows read and written today, account-wide: the meter, the 50% and 80% alerts and the brownout read this.
          const d1 = await syncD1Usage(env.DB, { token: env.CF_ANALYTICS_TOKEN, accountId: env.CF_ACCOUNT_ID }, new Date(controller.scheduledTime)).catch((e: unknown) => ({ meter: null, error: e instanceof Error ? e.message : 'D1 usage sync failed' }));
          if (d1.error) console.error('D1 usage sync failed', d1.error);
          const lab = Number(env.AI_RESEARCH_MONTHLY_CAP_USD);
          const result = await sendAdminAlerts(env.DB, {
            now: new Date(controller.scheduledTime),
            aiLabCapUsd: Number.isFinite(lab) && lab > 0 ? lab : null,
            fcmServiceAccount: env.FCM_SERVICE_ACCOUNT_JSON,
          });
          if (result.sent) console.log('Admin alert sent', result);
        })().catch((e) => console.error('Admin alerts failed', e)),
      );
    }
    // MUFAP fund prices are NOT fetched here: MUFAP's bot check challenges every fetch a Cron Trigger makes (no visitor
    // behind it), so signed-in web visits refresh them instead (lib/mufap-refresh.ts#freshenFunds).
    if (isFundRefreshTime(when)) {
      ctx.waitUntil(
        refreshPlanNavs(env.DB)
          .then((r) => console.log('Plan prices stored', r))
          .catch((e) => console.error('Plan price refresh failed', e)),
      );
    }
    ctx.waitUntil(
      startDueScrapers(env, controller.scheduledTime).catch((error) =>
        console.error('Starting scrapers failed', error),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
