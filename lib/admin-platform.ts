// The Platform page: how close the Workers are to Cloudflare's limits, and every sign of platform trouble from three
// independent sources: Cloudflare's own numbers (platform_metrics, needs the optional token on the cron Worker), the
// 5xx answers the Worker itself gave (server_errors), and the Cloudflare error pages users' browsers and phones saw
// (client_error events in the platform area). Counts only; no user data.
import { serverErrorSummary, type ServerErrorSummary } from './server-errors.ts';
import type { PipelineStatus } from './pipelines.ts';

export const FREE_DAILY_REQUESTS = 100_000;
export const FREE_CPU_MS = 10;

export type PlatformOptions = { now?: Date; dailyRequestLimit?: number; cpuLimitMs?: number };
export type ScriptDay = { day: string; script: string; requests: number; errors: number; limitHits: number; cpuP50: number | null; cpuP99: number | null; statuses: Record<string, number> };
export type PlatformReport = {
  now: string;
  status: PipelineStatus;
  headline: string;
  connected: boolean;
  lastSyncAt: string | null;
  /** Why the last sync failed (wrong token, account id ...), from the cron Worker's run record; null when it worked or never ran. */
  syncError: string | null;
  syncRanAt: string | null;
  dailyRequestLimit: number;
  cpuLimitMs: number;
  today: { requests: number; errors: number; limitHits: number; cpuP99: number | null; usedShare: number; scripts: ScriptDay[] };
  days: { day: string; requests: number; errors: number; limitHits: number }[];
  server: ServerErrorSummary;
  client: { code: string; n: number }[];
};

type Row = { day: string; script: string; requests: number; errors: number; limit_hits: number; cpu_p50: number | null; cpu_p99: number | null; statuses: string; fetched_at: string };

async function all<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T[]> {
  try { return (await db.prepare(sql).bind(...args).all<T>()).results; } catch { return []; }
}

export function judgePlatform(r: Pick<PlatformReport, 'connected' | 'dailyRequestLimit' | 'cpuLimitMs' | 'today' | 'server'>): { status: PipelineStatus; headline: string } {
  const t = r.today;
  if (t.limitHits > 0) return { status: 'failing', headline: `${t.limitHits.toLocaleString()} request${t.limitHits === 1 ? '' : 's'} hit a Cloudflare limit today.` };
  if (r.server.lastHour >= 20) return { status: 'failing', headline: `${r.server.lastHour} server errors in the last hour.` };
  if (r.connected && t.usedShare >= 0.8) return { status: 'late', headline: `Requests today are at ${Math.round(t.usedShare * 100)}% of the daily limit.` };
  if (t.cpuP99 !== null && t.cpuP99 >= r.cpuLimitMs * 0.8) return { status: 'late', headline: `CPU time per request is close to the ${r.cpuLimitMs} ms limit.` };
  if (r.server.last24h >= 5 && r.server.last24h >= r.server.previous24h * 2) return { status: 'late', headline: `Server errors doubled to ${r.server.last24h} in the last 24 hours.` };
  if (!r.connected) return { status: 'idle', headline: r.server.last24h ? `${r.server.last24h} server errors in 24 hours. Cloudflare limit data is not connected.` : 'Cloudflare limit data is not connected.' };
  return { status: 'ok', headline: `${t.requests.toLocaleString()} requests today, no limit hits.` };
}

export async function platformReport(db: D1Database, opts: PlatformOptions = {}): Promise<PlatformReport> {
  const now = opts.now ?? new Date();
  const dailyRequestLimit = opts.dailyRequestLimit ?? FREE_DAILY_REQUESTS;
  const cpuLimitMs = opts.cpuLimitMs ?? FREE_CPU_MS;
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const rows = await all<Row>(db, 'SELECT day,script,requests,errors,limit_hits,cpu_p50,cpu_p99,statuses,fetched_at FROM platform_metrics WHERE day>=? ORDER BY day,script', since);
  const lastSyncAt = rows.map((r) => r.fetched_at).sort((a, b) => a.localeCompare(b)).pop() ?? null;
  const lastRun = await db.prepare("SELECT finished_at,ok,detail FROM job_runs WHERE job='platform' ORDER BY started_at DESC, id DESC LIMIT 1").first<{ finished_at: string; ok: number; detail: string | null }>().catch(() => null);
  const connected = !!lastSyncAt && now.getTime() - Date.parse(lastSyncAt) < 3 * 3_600_000;
  const scripts = rows.filter((r) => r.day === today).map((r): ScriptDay => ({
    day: r.day, script: r.script, requests: r.requests, errors: r.errors, limitHits: r.limit_hits, cpuP50: r.cpu_p50, cpuP99: r.cpu_p99,
    statuses: (() => { try { return JSON.parse(r.statuses) as Record<string, number>; } catch { return {}; } })(),
  }));
  const sum = (key: 'requests' | 'errors' | 'limitHits') => scripts.reduce((n, s) => n + s[key], 0);
  const requests = sum('requests');
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now.getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10);
    const of = rows.filter((r) => r.day === day);
    return { day, requests: of.reduce((n, r) => n + r.requests, 0), errors: of.reduce((n, r) => n + r.errors, 0), limitHits: of.reduce((n, r) => n + r.limit_hits, 0) };
  });
  const sinceEvents = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const client = await all<{ code: string; n: number }>(
    db, "SELECT json_extract(props,'$.code') AS code, COUNT(*) AS n FROM analytics_events WHERE event='client_error' AND json_extract(props,'$.area')='platform' AND ts>=? AND is_admin=0 GROUP BY code ORDER BY n DESC", sinceEvents);
  const server = await serverErrorSummary(db, now).catch((): ServerErrorSummary => ({ last24h: 0, previous24h: 0, lastHour: 0, byRoute: [], series: [] }));
  const cpus = scripts.map((s) => s.cpuP99).filter((v): v is number => v !== null);
  const partial = {
    connected, dailyRequestLimit, cpuLimitMs, server,
    today: { requests, errors: sum('errors'), limitHits: sum('limitHits'), cpuP99: cpus.length ? Math.max(...cpus) : null, usedShare: requests / dailyRequestLimit, scripts },
  };
  return { now: now.toISOString(), ...judgePlatform(partial), lastSyncAt, syncError: lastRun && lastRun.ok === 0 ? lastRun.detail : null, syncRanAt: lastRun?.finished_at ?? null, days, client, ...partial };
}

/** Limits from Worker settings (CF_DAILY_REQUEST_LIMIT, CF_CPU_LIMIT_MS); the Workers Free plan's numbers by default. */
export function platformLimits(env: object): Pick<PlatformOptions, 'dailyRequestLimit' | 'cpuLimitMs'> {
  const vars = env as Record<string, unknown>;
  const req = Number(vars.CF_DAILY_REQUEST_LIMIT);
  const cpu = Number(vars.CF_CPU_LIMIT_MS);
  return { dailyRequestLimit: Number.isFinite(req) && req > 0 ? req : FREE_DAILY_REQUESTS, cpuLimitMs: Number.isFinite(cpu) && cpu > 0 ? cpu : FREE_CPU_MS };
}
