import { dispatchWorkflow, dueWorkflows } from '../../../lib/scrape-schedule';

// This Worker has no VAULT_DB binding and no way to learn what any user holds: it only starts public scrapers.
interface Env {
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
  const settings = { token: env.GITHUB_DISPATCH_TOKEN, repo: env.GITHUB_REPO, appEnv: env.APP_ENV };
  for (const { workflow, reason } of due) {
    const error = await dispatchWorkflow(settings, workflow);
    if (error) console.error(`Could not start ${workflow} (${reason}): ${error}`);
    else console.log(`Started ${workflow} (${reason}).`);
  }
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(startDueScrapers(env, controller.scheduledTime).catch((error) => console.error('Starting scrapers failed', error)));
  },
} satisfies ExportedHandler<Env>;
