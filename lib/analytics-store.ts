import { activeCounts, dailyActive, pktDay, retentionCohorts, returnedWithinWeek, DAY_MS, type DayUser } from './analytics-report.ts';
import { cleanVersion, type EventBatch, type IncomingEvent, type Platform } from './analytics-events.ts';

// D1 side of usage analytics. The privacy rule lives in lib/analytics-events.ts (closed enums only); this file adds
// the HMAC user key so the events table alone never names anyone.

export const RETENTION_DAYS = 180;

export async function userKey(email: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`analytics:${email.trim().toLowerCase()}`));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type EventContext = {
  sessionId: string;
  anonId?: string | null;
  userKey?: string | null;
  platform: Platform;
  appVersion?: string | null;
  isAdmin?: boolean;
};

export async function insertEvents(db: D1Database, ctx: EventContext, events: IncomingEvent[], now = new Date()) {
  if (!events.length) return 0;
  const ts = now.toISOString();
  const day = pktDay(now);
  const stmt = db.prepare(
    'INSERT INTO analytics_events (ts,day,user_key,anon_id,session_id,platform,app_version,event,props,is_admin) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  await db.batch(
    events.map((e) =>
      stmt.bind(ts, day, ctx.userKey ?? null, ctx.anonId ?? null, ctx.sessionId, ctx.platform, cleanVersion(ctx.appVersion), e.event,
        Object.keys(e.props).length ? JSON.stringify(e.props) : null, ctx.isAdmin ? 1 : 0),
    ),
  );
  return events.length;
}

export async function recordBatch(db: D1Database, batch: EventBatch, key: string | null, isAdmin: boolean) {
  return insertEvents(db, { sessionId: batch.sessionId, anonId: key ? null : batch.anonId, userKey: key, platform: batch.platform, appVersion: batch.appVersion, isAdmin }, batch.events);
}

/**
 * Called after a successful sign-in (web callback or phone exchange): upserts the account row and records a
 * `signed_in` event. A new row starts with origin 'unknown'; `resolveOrigin` settles it from the vault status, which
 * only the vault route may read. Never throws: analytics must not break signing in.
 */
export async function noteSignIn(
  db: D1Database,
  email: string,
  platform: Platform,
  secret: string,
  isAdmin: boolean,
  now = new Date(),
): Promise<void> {
  try {
    const addr = email.trim().toLowerCase();
    const ts = now.toISOString();
    const existing = await db.prepare('SELECT 1 AS x FROM app_users WHERE email=?').bind(addr).first();
    if (!existing) {
      await db.prepare('INSERT OR IGNORE INTO app_users (email,first_seen_at,first_platform,last_seen_at,last_platform,origin) VALUES (?,?,?,?,?,?)')
        .bind(addr, ts, platform, ts, platform, 'unknown').run();
    } else {
      await db.prepare('UPDATE app_users SET last_seen_at=?, last_platform=? WHERE email=?').bind(ts, platform, addr).run();
    }
    const key = await userKey(addr, secret);
    await insertEvents(db, { sessionId: crypto.randomUUID(), userKey: key, platform, isAdmin }, [{ event: 'signed_in', props: { platform } }], now);
  } catch (error) {
    console.error('Could not record sign-in analytics', error);
  }
}

/**
 * Settles a new account's origin the first time its vault status is read: a vault that already exists means the account
 * predates analytics ('existing'); none means a genuine new sign-up ('signup', which records `signed_up`). Rows that
 * already have an origin are left alone, so this is cheap to call on every status read. Never throws.
 */
export async function resolveOrigin(db: D1Database, email: string, hasVault: boolean, secret: string, isAdmin: boolean, now = new Date()): Promise<void> {
  try {
    const addr = email.trim().toLowerCase();
    const row = await db.prepare('SELECT origin, last_platform AS platform FROM app_users WHERE email=?').bind(addr).first<{ origin: string; platform: string }>();
    if (!row || row.origin !== 'unknown') return;
    const origin = hasVault ? 'existing' : 'signup';
    const changed = await db.prepare("UPDATE app_users SET origin=? WHERE email=? AND origin='unknown'").bind(origin, addr).run();
    if (origin === 'signup' && changed.meta.changes > 0) {
      const platform = (['web', 'android', 'ios'] as const).find((p) => p === row.platform) ?? 'other';
      await insertEvents(db, { sessionId: crypto.randomUUID(), userKey: await userKey(addr, secret), platform, isAdmin }, [{ event: 'signed_up', props: { platform } }], now);
    }
  } catch (error) {
    console.error('Could not settle analytics origin', error);
  }
}

/** Removes one user's events (account deletion). */
export async function deleteUserEvents(db: D1Database, email: string, secret: string) {
  await db.prepare('DELETE FROM analytics_events WHERE user_key=?').bind(await userKey(email, secret)).run();
}

export async function purgeOldEvents(db: D1Database, now = new Date()) {
  const cutoff = pktDay(new Date(now.getTime() - RETENTION_DAYS * DAY_MS));
  await db.prepare('DELETE FROM analytics_events WHERE day<?').bind(cutoff).run();
}

export type UsageReport = ReturnType<typeof shapeReport>;

const NOISE = ['account_state', 'screen_viewed', 'app_opened', 'signed_in', 'signed_up', 'landing_viewed', 'sign_in_clicked', 'client_error'];

/** All dashboard numbers for the super admin. Own (admin) activity is excluded unless `includeAdmin`. */
export async function usageReport(db: D1Database, includeAdmin = false, now = new Date()) {
  const today = pktDay(now);
  const since = pktDay(new Date(now.getTime() - 120 * DAY_MS));
  const since30 = pktDay(new Date(now.getTime() - 29 * DAY_MS));
  const adminClause = includeAdmin ? '' : 'AND is_admin=0';
  const all = async <T,>(sql: string, ...p: unknown[]) => (await db.prepare(sql).bind(...p).all<T>()).results;
  const one = async <T,>(sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p).first<T>();

  const activity = await all<DayUser>(`SELECT DISTINCT user_key AS userKey, day FROM analytics_events WHERE user_key IS NOT NULL AND day>=? ${adminClause}`, since);
  const signups = await all<DayUser>(`SELECT user_key AS userKey, MIN(day) AS day FROM analytics_events WHERE event='signed_up' AND user_key IS NOT NULL AND day>=? ${adminClause} GROUP BY user_key`, since);
  const features = await all<{ event: string; platform: string; n: number; users: number }>(
    `SELECT event, platform, COUNT(*) AS n, COUNT(DISTINCT user_key) AS users FROM analytics_events WHERE day>=? ${adminClause} AND user_key IS NOT NULL GROUP BY event, platform`, since30);
  const screens = await all<{ screen: string; n: number; users: number }>(
    `SELECT json_extract(props,'$.screen') AS screen, COUNT(*) AS n, COUNT(DISTINCT user_key) AS users FROM analytics_events WHERE event='screen_viewed' AND day>=? ${adminClause} AND user_key IS NOT NULL GROUP BY screen ORDER BY users DESC, n DESC`, since30);
  const count = async (event: string, col: 'user_key' | 'anon_id') =>
    (await one<{ n: number }>(`SELECT COUNT(DISTINCT ${col}) AS n FROM analytics_events WHERE event=? AND day>=? ${adminClause}`, event, since30))?.n ?? 0;
  const content = (await one<{ n: number }>(
    `SELECT COUNT(DISTINCT user_key) AS n FROM analytics_events WHERE event IN ('entry_added','import_completed','asset_added') AND day>=? ${adminClause}`, since30))?.n ?? 0;
  const accounts = await one<{ total: number; signups30: number; signups7: number }>(
    `SELECT COUNT(*) AS total, SUM(origin IN ('signup','unknown') AND first_seen_at>=?) AS signups30, SUM(origin IN ('signup','unknown') AND first_seen_at>=?) AS signups7 FROM app_users`,
    `${since30}T00:00:00Z`, `${pktDay(new Date(now.getTime() - 6 * DAY_MS))}T00:00:00Z`);
  const signupSeries = await all<{ day: string; n: number }>(
    `SELECT substr(first_seen_at,1,10) AS day, COUNT(*) AS n FROM app_users WHERE origin IN ('signup','unknown') AND first_seen_at>=? GROUP BY day ORDER BY day`, `${since30}T00:00:00Z`);

  return shapeReport({ today, activity, signups, features, screens, accounts, signupSeries, funnelCounts: {
    landing: await count('landing_viewed', 'anon_id'), clicked: await count('sign_in_clicked', 'anon_id'),
    signedUp: await count('signed_up', 'user_key'), vault: await count('vault_created', 'user_key'), content,
  }, includeAdmin, now });
}

export function shapeReport(i: {
  today: string; activity: DayUser[]; signups: DayUser[]; includeAdmin: boolean; now: Date;
  features: { event: string; platform: string; n: number; users: number }[];
  screens: { screen: string; n: number; users: number }[];
  accounts: { total: number; signups30: number | null; signups7: number | null } | null;
  signupSeries: { day: string; n: number }[];
  funnelCounts: { landing: number; clicked: number; signedUp: number; vault: number; content: number };
}) {
  const byEvent = new Map<string, { event: string; users: number; count: number; web: number; phone: number }>();
  for (const f of i.features) {
    const row = byEvent.get(f.event) ?? { event: f.event, users: 0, count: 0, web: 0, phone: 0 };
    row.count += f.n;
    row.users = Math.max(row.users, f.users);
    if (f.platform === 'web') row.web += f.n; else row.phone += f.n;
    byEvent.set(f.event, row);
  }
  const f = i.funnelCounts;
  const from30 = pktDay(new Date(i.now.getTime() - 29 * DAY_MS));
  const signedUpSet = i.signups.filter((s) => s.day >= from30);
  const returned = returnedWithinWeek(signedUpSet, i.activity);
  return {
    generatedAt: i.now.toISOString(),
    includesAdmin: i.includeAdmin,
    totalUsers: i.accounts?.total ?? 0,
    signups7: i.accounts?.signups7 ?? 0,
    signups30: i.accounts?.signups30 ?? 0,
    active: activeCounts(i.activity, i.today),
    dailyActive: dailyActive(i.activity, i.today, 30),
    signupSeries: i.signupSeries,
    features: [...byEvent.values()].filter((r) => !NOISE.includes(r.event)).sort((a, b) => b.users - a.users || b.count - a.count),
    errors: [...byEvent.values()].filter((r) => r.event === 'client_error' || r.event.endsWith('_failed')),
    screens: i.screens.filter((s) => s.screen),
    funnel: [
      { step: 'Visited the landing page', users: f.landing },
      { step: 'Clicked sign in', users: f.clicked },
      { step: 'Signed up', users: f.signedUp },
      { step: 'Created a vault', users: f.vault },
      { step: 'Added first entry or import', users: f.content },
      { step: 'Came back within 7 days (sign-ups, last 30 days)', users: returned },
    ],
    retention: retentionCohorts(i.signups, i.activity, i.today),
  };
}
