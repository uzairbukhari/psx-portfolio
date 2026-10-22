// D1 free-plan meter. Production, staging and both vault databases share one account-wide allowance of 5 million rows
// read and 100,000 rows written per UTC day; passing it makes every D1 call fail until 00:00 UTC (the vault included).
// Cloudflare's GraphQL Analytics API still answers then, so the cron Worker copies today's totals into `d1_usage_days`
// (needs the same CF_ANALYTICS_TOKEN as the Platform page: Account Analytics: Read). The admin console shows them, the
// alert check pushes at 50% and 80%, and from 80% the "brownout" slows the scrapers and the admin pages so the app
// itself keeps its headroom. Operational numbers only: no user data.

export const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';
export const FREE_DAILY_READS = 5_000_000;
export const FREE_DAILY_WRITES = 100_000;

/** Share of the daily allowance at which each level starts. */
export const LEVELS = { notice: 0.5, warn: 0.8, critical: 0.95 } as const;
export type D1Level = 'ok' | 'notice' | 'warn' | 'critical';

export const QUERY = `query D1Day($account: String!, $day: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $day, date_leq: $day }) {
      sum { rowsRead rowsWritten }
      dimensions { databaseId }
    }
  } }
}`;

export type D1Day = { reads: number; writes: number; byDb: Record<string, { reads: number; writes: number }> };

type Group = { sum?: { rowsRead?: number; rowsWritten?: number }; dimensions?: { databaseId?: string } };

/** Adds up the per-database groups of one day. Returns null when the response has no D1 data node at all. */
export function parseD1Day(response: unknown): D1Day | null {
  const groups = (response as { data?: { viewer?: { accounts?: { d1AnalyticsAdaptiveGroups?: Group[] }[] } } })?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
  if (!Array.isArray(groups)) return null;
  const out: D1Day = { reads: 0, writes: 0, byDb: {} };
  for (const g of groups) {
    const reads = Number(g.sum?.rowsRead) || 0;
    const writes = Number(g.sum?.rowsWritten) || 0;
    const id = String(g.dimensions?.databaseId ?? 'unknown');
    out.reads += reads;
    out.writes += writes;
    const held = out.byDb[id] ?? { reads: 0, writes: 0 };
    out.byDb[id] = { reads: held.reads + reads, writes: held.writes + writes };
  }
  return out;
}

export type CfSettings = { token?: string; accountId?: string };

/** Fetches today's (UTC) D1 totals. Never throws; `error` says why nothing came back. */
export async function fetchD1Day(settings: CfSettings, now = new Date(), fetcher: typeof fetch = fetch): Promise<{ usage: D1Day } | { error: string }> {
  if (!settings.token || !settings.accountId) return { error: 'CF_ANALYTICS_TOKEN or CF_ACCOUNT_ID is not set' };
  try {
    const res = await fetcher(GRAPHQL_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { account: settings.accountId, day: now.toISOString().slice(0, 10) } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { error: `Cloudflare answered ${res.status} for D1 usage${res.status === 401 || res.status === 403 ? ' (check the token permission: Account Analytics Read)' : ''}` };
    const body: unknown = await res.json();
    const parsed = parseD1Day(body);
    if (!parsed) {
      const first = (body as { errors?: { message?: string }[] })?.errors?.[0]?.message;
      return { error: `No D1 usage data${first ? `: ${first}` : ' (wrong account id, or the token cannot read D1 analytics?)'}` };
    }
    return { usage: parsed };
  } catch (e) { return { error: e instanceof Error ? e.message : 'Could not reach Cloudflare' }; }
}

export function d1Level(share: number): D1Level {
  return share >= LEVELS.critical ? 'critical' : share >= LEVELS.warn ? 'warn' : share >= LEVELS.notice ? 'notice' : 'ok';
}

export type D1Meter = {
  day: string;
  reads: number;
  writes: number;
  readShare: number;
  writeShare: number;
  /** The worse of the two. */
  level: D1Level;
  fetchedAt: string;
};

export function meterFrom(row: { day: string; reads: number; writes: number; fetched_at: string }, limits: { reads?: number; writes?: number } = {}): D1Meter {
  const readShare = row.reads / (limits.reads ?? FREE_DAILY_READS);
  const writeShare = row.writes / (limits.writes ?? FREE_DAILY_WRITES);
  return { day: row.day, reads: row.reads, writes: row.writes, readShare, writeShare, level: d1Level(Math.max(readShare, writeShare)), fetchedAt: row.fetched_at };
}

type Db = Pick<D1Database, 'prepare'>;

export async function storeD1Day(db: Db, usage: D1Day, now = new Date()): Promise<void> {
  await db.prepare(
    `INSERT INTO d1_usage_days (day,reads,writes,by_db,fetched_at) VALUES (?,?,?,?,?)
     ON CONFLICT(day) DO UPDATE SET reads=excluded.reads, writes=excluded.writes, by_db=excluded.by_db, fetched_at=excluded.fetched_at`,
  ).bind(now.toISOString().slice(0, 10), usage.reads, usage.writes, JSON.stringify(usage.byDb), now.toISOString()).run();
}

/** The last `days` UTC days, oldest first (a primary-key range: one row per day). */
export async function readD1Days(db: Db, now = new Date(), days = 14) {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  try {
    return (await db.prepare('SELECT day,reads,writes,by_db,fetched_at FROM d1_usage_days WHERE day>=? ORDER BY day').bind(since).all<{ day: string; reads: number; writes: number; by_db: string; fetched_at: string }>()).results;
  } catch { return []; }
}

// The brownout is one row: refresh_state ('limits','brownout') whose last_success_at holds the UTC day it was set for.
// It ends by itself at 00:00 UTC (the day no longer matches), so nothing has to clear it.
const BROWNOUT_SQL = "SELECT last_success_at AS day FROM refresh_state WHERE kind='limits' AND key='brownout'";

export async function setBrownout(db: Db, on: boolean, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const at = now.toISOString();
  if (on) {
    await db.prepare(
      `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,failure_count) VALUES ('limits','brownout',?,?,0)
       ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at`,
    ).bind(at, day).run();
  } else {
    await db.prepare("DELETE FROM refresh_state WHERE kind='limits' AND key='brownout' AND last_success_at=?").bind(day).run();
  }
}

export async function isBrownout(db: Db, now = new Date()): Promise<boolean> {
  try {
    const row = await db.prepare(BROWNOUT_SQL).first<{ day: string | null }>();
    return !!row?.day && row.day === now.toISOString().slice(0, 10);
  } catch { return false; }
}

/**
 * Copies today's totals in and switches the brownout on or off from them. Writes at most two rows (the day and the
 * brownout flag, only when it changes), so the meter itself costs next to nothing. Returns a problem for the job log.
 */
export async function syncD1Usage(db: Db, settings: CfSettings, now = new Date(), fetcher: typeof fetch = fetch): Promise<{ meter: D1Meter | null; error: string | null }> {
  const result = await fetchD1Day(settings, now, fetcher);
  if ('error' in result) return { meter: null, error: result.error };
  await storeD1Day(db, result.usage, now);
  const meter = meterFrom({ day: now.toISOString().slice(0, 10), reads: result.usage.reads, writes: result.usage.writes, fetched_at: now.toISOString() });
  const hot = meter.level === 'warn' || meter.level === 'critical';
  if (hot !== (await isBrownout(db, now))) await setBrownout(db, hot, now);
  return { meter, error: null };
}
