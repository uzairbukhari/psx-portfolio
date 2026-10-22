// Cloudflare Cron Triggers fire on time; GitHub's own `schedule:` runs are often delayed for hours or
// dropped. The quote-refresh Worker therefore starts the market-hours scrapers itself with
// `workflow_dispatch`. PSX is still fetched from the GitHub runner, never from Cloudflare.
export type ScheduledWorkflow = { workflow: string; reason: string };

/**
 * Which workflows are due at this Cron Trigger firing (UTC): quotes every tick, history every 15 min, plus the post-close
 * close. In a D1 brownout (80% of the free daily rows used, see lib/d1-usage.ts) quotes run every 15 minutes and history
 * hourly, which still leaves the app fresh prices while it keeps its headroom for the rest of the UTC day.
 */
export function dueWorkflows(when: Date, brownout = false): ScheduledWorkflow[] {
  const day = when.getUTCDay();
  if (day === 0 || day === 6) return [];
  const hour = when.getUTCHours();
  const minute = when.getUTCMinutes();
  const due: ScheduledWorkflow[] = [];
  if (hour >= 4 && hour <= 11) {
    if (!brownout || minute % 15 === 0) due.push({ workflow: 'psx-quotes.yml', reason: brownout ? 'market hours, every 15 minutes (D1 brownout)' : 'market hours, every 5 minutes' });
    if (brownout ? minute === 0 : minute % 15 === 0) due.push({ workflow: 'psx-history.yml', reason: brownout ? 'market hours, hourly (D1 brownout)' : 'market hours, every 15 minutes' });
  }
  if (hour === 12 && minute >= 10 && minute < 15) due.push({ workflow: 'psx-history.yml', reason: 'after the close, final daily close' });
  return due;
}

/**
 * The free Workers plan allows 5 cron triggers per account, so the cron Worker has ONE trigger (every 5 minutes, every day)
 * and decides here what is due, using the scheduled time (UTC). Keep `triggers.crons` in wrangler.jsonc to that one entry.
 */
/** MUFAP fund prices: weekdays 17:30 UTC (22:30 PKT), 05:00 and 09:00 UTC (mid-morning and mid-afternoon PKT). */
export function isFundRefreshTime(when: Date): boolean {
  const day = when.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hm = when.getUTCHours() * 60 + when.getUTCMinutes();
  return hm === 17 * 60 + 30 || hm === 5 * 60 || hm === 9 * 60;
}

/** Platform numbers and admin alerts: minute 15 and 45 of every hour, any day. */
export function isPlatformTime(when: Date): boolean {
  const minute = when.getUTCMinutes();
  return minute === 15 || minute === 45;
}

export type DispatchSettings = { token?: string; repo?: string; appEnv?: string };

/** Starts one workflow on main. Never throws; returns an error message or null. */
export async function dispatchWorkflow(settings: DispatchSettings, workflow: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (settings.appEnv === 'staging') return 'staging never starts the production scrapers';
  if (!settings.token || !settings.repo) return 'GITHUB_DISPATCH_TOKEN or GITHUB_REPO is not set on the quote-refresh Worker';
  try {
    const response = await fetcher(`https://api.github.com/repos/${settings.repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'psx-portfolio-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? null : `GitHub answered ${response.status}`;
  } catch (error) {
    return error instanceof Error ? error.message : 'dispatch failed';
  }
}
