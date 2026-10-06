import { refreshFunds } from '../../../lib/mufap-refresh';
import { dispatchWorkflow, dueWorkflows } from '../../../lib/scrape-schedule';

// This Worker has no VAULT_DB binding and no way to learn what any user holds: it only starts public scrapers.
interface Env {
  DB: Parameters<typeof refreshFunds>[0];
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
    if (error)
      console.error(`Could not start ${workflow} (${reason}): ${error}`);
    else console.log(`Started ${workflow} (${reason}).`);
  }
}

const MUFAP_CRON = '30 17 * * 1-5';

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    // MUFAP blocks GitHub's runners but answers Cloudflare, so the fund prices are fetched here (public data, no user data).
    if (controller.cron === MUFAP_CRON) {
      ctx.waitUntil(
        refreshFunds(env.DB)
          .then((r) => console.log('Fund prices stored', r))
          .catch((error) => console.error('Fund price refresh failed', error)),
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
