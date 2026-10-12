// Cloudflare's own view of the Workers (requests, errors, CPU, platform limit hits) from the GraphQL Analytics API.
// This is the only place a limit hit is visible when the Worker never got to run its own code (1102 and friends), so the
// cron Worker copies it into `platform_metrics` once the optional CF_ANALYTICS_TOKEN secret is set. Public operational
// numbers only. Pure parsing here; the cron Worker does the fetch.

export const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

export const QUERY = `query WorkerDay($account: String!, $script: String!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(limit: 100, filter: { scriptName: $script, datetime_geq: $from, datetime_leq: $to }) {
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP99 }
      dimensions { status }
    }
  } }
}`;

export type DayMetrics = {
  requests: number; errors: number; limitHits: number; cpuP50: number | null; cpuP99: number | null; statuses: Record<string, number>;
};

/** Statuses that mean the invocation itself was fine (a visitor leaving early is not an error). */
const HEALTHY = new Set(['success', 'clientDisconnected', 'responseStreamDisconnected']);
const isLimit = (status: string) => /^exceeded|limit/i.test(status);

type Group = { sum?: { requests?: number; errors?: number }; quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number }; dimensions?: { status?: string } };

/** Folds the per-status groups of one Worker and day into one row. Unknown status names are kept as they come. */
export function parseWorkerDay(response: unknown): DayMetrics | null {
  const groups = (response as { data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: Group[] }[] } } })?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if (!Array.isArray(groups)) return null;
  const out: DayMetrics = { requests: 0, errors: 0, limitHits: 0, cpuP50: null, cpuP99: null, statuses: {} };
  let weight = 0;
  for (const g of groups) {
    const n = Number(g.sum?.requests) || 0;
    const status = String(g.dimensions?.status ?? 'unknown');
    out.requests += n;
    out.statuses[status] = (out.statuses[status] ?? 0) + n;
    if (!HEALTHY.has(status)) out.errors += n;
    if (isLimit(status)) out.limitHits += n;
    if (n && typeof g.quantiles?.cpuTimeP99 === 'number') out.cpuP99 = Math.max(out.cpuP99 ?? 0, g.quantiles.cpuTimeP99);
    if (n && typeof g.quantiles?.cpuTimeP50 === 'number') { out.cpuP50 = ((out.cpuP50 ?? 0) * weight + g.quantiles.cpuTimeP50 * n) / (weight + n); weight += n; }
  }
  return out;
}

export type CfSettings = { token?: string; accountId?: string };

/** Fetches today's (UTC) numbers for one Worker. Never throws; `error` says why nothing came back. CPU times are microseconds in the API. */
export async function fetchWorkerDay(settings: CfSettings, script: string, now = new Date(), fetcher: typeof fetch = fetch): Promise<{ metrics: DayMetrics } | { error: string }> {
  if (!settings.token || !settings.accountId) return { error: 'CF_ANALYTICS_TOKEN or CF_ACCOUNT_ID is not set' };
  const day = now.toISOString().slice(0, 10);
  try {
    const res = await fetcher(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { account: settings.accountId, script, from: `${day}T00:00:00Z`, to: now.toISOString() } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { error: `Cloudflare answered ${res.status} for ${script}${res.status === 401 || res.status === 403 ? ' (check the token permission: Account Analytics Read)' : ''}` };
    const body: unknown = await res.json();
    const parsed = parseWorkerDay(body);
    if (!parsed) {
      const first = (body as { errors?: { message?: string }[] })?.errors?.[0]?.message;
      return { error: `No data for ${script}${first ? `: ${first}` : ' (wrong account id or script name?)'}` };
    }
    return { metrics: { ...parsed, cpuP50: parsed.cpuP50 === null ? null : parsed.cpuP50 / 1000, cpuP99: parsed.cpuP99 === null ? null : parsed.cpuP99 / 1000 } };
  } catch (e) { return { error: e instanceof Error ? e.message : 'Could not reach Cloudflare' }; }
}

export async function storeWorkerDay(db: Pick<D1Database, 'prepare'>, script: string, m: DayMetrics, now = new Date()): Promise<void> {
  await db.prepare(
    `INSERT INTO platform_metrics (day,script,requests,errors,limit_hits,cpu_p50,cpu_p99,statuses,fetched_at) VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(day,script) DO UPDATE SET requests=excluded.requests, errors=excluded.errors, limit_hits=excluded.limit_hits,
       cpu_p50=excluded.cpu_p50, cpu_p99=excluded.cpu_p99, statuses=excluded.statuses, fetched_at=excluded.fetched_at`,
  ).bind(now.toISOString().slice(0, 10), script, m.requests, m.errors, m.limitHits, m.cpuP50, m.cpuP99, JSON.stringify(m.statuses), now.toISOString()).run();
}

/** Copies today's numbers for each Worker into the database; returns how many were stored and the first problem, if any. */
export async function syncPlatformMetrics(db: Pick<D1Database, 'prepare'>, settings: CfSettings, scripts: string[], now = new Date(), fetcher: typeof fetch = fetch): Promise<{ stored: number; error: string | null }> {
  let stored = 0;
  let error: string | null = null;
  for (const script of scripts) {
    const result = await fetchWorkerDay(settings, script, now, fetcher);
    if ('metrics' in result) { await storeWorkerDay(db, script, result.metrics, now); stored += 1; }
    else error ??= result.error;
  }
  return { stored, error };
}
