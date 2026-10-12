import { refreshFundPayouts, refreshFunds } from '../../../lib/mufap-refresh';
import { refreshPlanNavs } from '../../../lib/plan-navs';
import { recordJobRun } from '../../../lib/job-runs';
import { PIPELINES } from '../../../lib/pipelines';
import { dispatchWorkflow, dueWorkflows } from '../../../lib/scrape-schedule';

// This Worker has no VAULT_DB binding and no way to learn what any user holds: it only starts public scrapers.
interface Env {
  DB: D1Database;
  GITHUB_DISPATCH_TOKEN?: string;
  GITHUB_REPO?: string;
  APP_ENV?: string;
}

/**
 * PSX refuses Cloudflare's network, so this Worker never fetches prices. It starts the GitHub Actions scrapers
 * (quotes every 5 minutes, history every 15, plus the post-close run) on time, because GitHub's own `schedule:`
 * triggers run hours late or are dropped. The workflows keep their GitHub cron as a fallback.
 */
async function startDueScrapers(env: Env, scheduledTime: number) {
  const due = dueWorkflows(new Date(scheduledTime));
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

// MUFAP publishes at no fixed hour, so besides the nightly run (22:30 PKT) it is read again mid-morning and mid-afternoon.
const MUFAP_CRONS = new Set(['30 17 * * 1-5', '0 5 * * 1-5', '0 9 * * 1-5']);

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
    // MUFAP blocks GitHub's runners but answers Cloudflare, so the fund prices are fetched here (public data, no user data).
    if (MUFAP_CRONS.has(controller.cron)) {
      ctx.waitUntil(
        (async () => {
          // Two independent public sources: one failing must not stop the other.
          const startedAt = new Date().toISOString();
          await refreshFunds(env.DB)
            .then(async (r) => {
              console.log('Fund prices stored', r);
              await recordJobRun(env.DB, { job: 'funds', source: 'cron', startedAt, ok: true, detail: `${r.funds} funds, ${r.prices} prices` }).catch(() => {});
            })
            .catch(async (e) => {
              console.error('Fund price refresh failed', e);
              await recordJobRun(env.DB, { job: 'funds', source: 'cron', startedAt, ok: false, detail: e }).catch(() => {});
            });
          await refreshFundPayouts(env.DB)
            .then((r) => console.log('Fund payouts stored', r))
            .catch((e) => console.error('Fund payout refresh failed', e));
          await refreshPlanNavs(env.DB)
            .then((r) => console.log('Plan prices stored', r))
            .catch((e) => console.error('Plan price refresh failed', e));
        })(),
      );
      return;
    }
    ctx.waitUntil(
      startDueScrapers(env, controller.scheduledTime).catch((error) =>
        console.error('Starting scrapers failed', error),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
