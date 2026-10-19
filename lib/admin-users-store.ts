import { pktDay, DAY_MS } from './analytics-report.ts';
import { INTERNAL_EMAILS, userKeys } from './analytics-store.ts';
import {
  SEGMENTS, SEGMENT_LABEL, STAGES, STAGE_LABEL, groupTimeline, segmentsOf, stageOf,
  type Segment, type Stage, type TimelineEvent, type UserSummary,
} from './user-lifecycle.ts';

// D1 side of the admin People view. The events table names nobody (HMAC user key); the join to an email happens here,
// at read time, by recomputing the key for each account in `app_users`. Main database only, never the vault.

export type UserRow = {
  email: string; name: string | null; picture: string | null;
  joined: string; lastSeenAt: string; lastActive: string; platform: string; origin: string;
  internal: boolean; hasUsage: boolean; stage: Stage; segments: Segment[];
  sessions: number; activeDays30: number; errors7: number;
};

export type UserDirectory = {
  generatedAt: string;
  users: UserRow[];
  funnel: { stage: Stage; label: string; reached: number; stuck: number }[];
  segments: { id: Segment; label: string; users: number }[];
};

type AccountRow = { email: string; name: string | null; picture: string | null; first: string; last: string; platform: string; origin: string };
const SERVER_EVENTS = "('signed_in','signed_up','account_state')";

export async function userDirectory(db: D1Database, secret: string, includeInternal: boolean, now = new Date()): Promise<UserDirectory> {
  const today = pktDay(now);
  const since30 = pktDay(new Date(now.getTime() - 29 * DAY_MS));
  const since7 = pktDay(new Date(now.getTime() - 6 * DAY_MS));
  const all = async <T,>(sql: string, ...p: unknown[]) => (await db.prepare(sql).bind(...p).all<T>()).results;

  const accounts = await all<AccountRow>(
    `SELECT lower(email) AS email, name, picture, first_seen_at AS first, last_seen_at AS last, last_platform AS platform, origin FROM app_users
     ${includeInternal ? '' : `WHERE lower(email) NOT IN (${INTERNAL_EMAILS})`} ORDER BY last_seen_at DESC LIMIT 2000`);
  const internal = new Set((await all<{ email: string }>("SELECT lower(email) AS email FROM user_roles WHERE role IN ('super_admin','tester')")).map((r) => r.email));
  const keys = secret ? await userKeys(accounts.map((a) => a.email), secret) : accounts.map(() => '');

  const milestones = await all<{ user_key: string; event: string; vault: string | null }>(
    `SELECT user_key, event, json_extract(props,'$.vault') AS vault FROM analytics_events WHERE user_key IS NOT NULL
     AND event IN ('vault_created','account_state','entry_added','import_completed','asset_added','targets_saved','picks_run_completed') GROUP BY user_key, event, vault`);
  const activity = await all<{ user_key: string; sessions: number; lastDay: string; active30: number; usage: number }>(
    `SELECT user_key, COUNT(DISTINCT session_id) AS sessions, MAX(day) AS lastDay, COUNT(DISTINCT CASE WHEN day>=? THEN day END) AS active30,
     SUM(event NOT IN ${SERVER_EVENTS}) AS usage FROM analytics_events WHERE user_key IS NOT NULL GROUP BY user_key`, since30);
  const errors = await all<{ user_key: string; n: number }>(
    `SELECT user_key, COUNT(*) AS n FROM analytics_events WHERE event='client_error' AND user_key IS NOT NULL AND day>=? GROUP BY user_key`, since7);
  const sip = await all<{ user_key: string; days: number; lastDay: string }>(
    `SELECT user_key, COUNT(DISTINCT day) AS days, MAX(day) AS lastDay FROM analytics_events WHERE user_key IS NOT NULL
     AND event IN ('targets_saved','picks_run_completed') GROUP BY user_key`);

  const flags = new Map<string, Set<string>>();
  for (const m of milestones) {
    const set = flags.get(m.user_key) ?? new Set<string>();
    set.add(m.event === 'account_state' ? `account_state:${m.vault ?? ''}` : m.event);
    flags.set(m.user_key, set);
  }
  const act = new Map(activity.map((r) => [r.user_key, r]));
  const err = new Map(errors.map((r) => [r.user_key, r.n]));
  const sipBy = new Map(sip.map((r) => [r.user_key, r]));

  const users = accounts.map((a, i): UserRow => {
    const key = keys[i];
    const f = flags.get(key) ?? new Set<string>();
    const ac = act.get(key);
    const seenDay = pktDay(new Date(a.last));
    const summary: UserSummary = {
      firstSeenDay: pktDay(new Date(a.first)),
      lastActiveDay: ac && ac.lastDay > seenDay ? ac.lastDay : seenDay,
      origin: a.origin,
      vaultCreated: f.has('vault_created'),
      vaultExists: f.has('account_state:exists'),
      content: f.has('entry_added') || f.has('import_completed') || f.has('asset_added'),
      targets: f.has('targets_saved'),
      picks: f.has('picks_run_completed'),
      activeDays30: ac?.active30 ?? 0,
      errors7: err.get(key) ?? 0,
      sipDays: sipBy.get(key)?.days ?? 0,
      lastSipDay: sipBy.get(key)?.lastDay ?? null,
      hasUsage: (ac?.usage ?? 0) > 0,
    };
    return {
      email: a.email, name: a.name, picture: a.picture, joined: a.first, lastSeenAt: a.last, lastActive: summary.lastActiveDay,
      platform: a.platform, origin: a.origin, internal: internal.has(a.email), hasUsage: summary.hasUsage,
      stage: stageOf(summary), segments: segmentsOf(summary, today),
      sessions: ac?.sessions ?? 0, activeDays30: summary.activeDays30, errors7: summary.errors7,
    };
  });

  return {
    generatedAt: now.toISOString(),
    users,
    funnel: STAGES.map((stage, i) => ({
      stage, label: STAGE_LABEL[stage],
      reached: users.filter((u) => STAGES.indexOf(u.stage) >= i).length,
      stuck: users.filter((u) => u.stage === stage).length,
    })),
    segments: SEGMENTS.map((id) => ({ id, label: SEGMENT_LABEL[id], users: users.filter((u) => u.segments.includes(id)).length })),
  };
}

export type UserTimeline = NonNullable<Awaited<ReturnType<typeof userTimeline>>>;

/** One account's recent events as sessions, plus 90 days of activity. Returns null for an unknown email. */
export async function userTimeline(db: D1Database, secret: string, email: string, now = new Date()) {
  const addr = email.trim().toLowerCase();
  const account = await db.prepare('SELECT lower(email) AS email, name, picture, first_seen_at AS joined, last_seen_at AS lastSeenAt, last_platform AS platform, origin FROM app_users WHERE lower(email)=?')
    .bind(addr).first<{ email: string; name: string | null; picture: string | null; joined: string; lastSeenAt: string; platform: string; origin: string }>();
  if (!account || !secret) return null;
  const [key] = await userKeys([addr], secret);
  const since = pktDay(new Date(now.getTime() - 89 * DAY_MS));
  const rows = (await db.prepare(
    'SELECT ts, session_id AS sessionId, platform, app_version AS appVersion, event, props FROM analytics_events WHERE user_key=? ORDER BY id DESC LIMIT 500',
  ).bind(key).all<TimelineEvent>()).results.reverse();
  const days = (await db.prepare('SELECT day, COUNT(*) AS n FROM analytics_events WHERE user_key=? AND day>=? GROUP BY day').bind(key, since).all<{ day: string; n: number }>()).results;
  return {
    ...account,
    truncated: rows.length >= 500,
    sessions: groupTimeline(rows),
    activity: Array.from({ length: 90 }, (_, i) => {
      const day = pktDay(new Date(now.getTime() - (89 - i) * DAY_MS));
      return { day, n: days.find((d) => d.day === day)?.n ?? 0 };
    }),
  };
}

/** Looking up one person is itself recorded, so the audit trail shows who opened whose activity and when. */
export async function logUserView(db: D1Database, actor: string, email: string, now = new Date()) {
  await db.prepare('INSERT INTO admin_actions (at,actor,action,target,result) VALUES (?,?,?,?,?)')
    .bind(now.toISOString(), actor, 'user_viewed', email.trim().toLowerCase(), 'ok').run();
}
