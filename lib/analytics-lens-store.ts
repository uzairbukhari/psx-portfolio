// Loads what the Analytics lenses need from the main D1 database (never VAULT_DB): event rows for the window plus its
// history, and each account's first-seen day and sign-up attribution under its HMAC user key. The email is only used
// here to compute that key and never leaves this function.
import { pktDay } from './analytics-report.ts';
import { parseRow, type RawEventRow } from './analytics-rows.ts';
import { buildLens, historyDays, type LensQuery } from './analytics-lenses.ts';
import type { AcquiredUser } from './analytics-acquisition.ts';
import { excludeKeys, INTERNAL_EMAILS, userKeys } from './analytics-store.ts';

/** A ceiling on rows read per report, so one request can never run away with the daily D1 read allowance. */
export const MAX_ROWS = 250_000;

export async function lensReport(db: D1Database, secret: string, q: LensQuery, includeAdmin: boolean, internalKeys: string[], now = new Date()) {
  const since = pktDay(new Date(now.getTime() - (historyDays(q.days) - 1) * 86_400_000));
  const adminClause = includeAdmin ? '' : `AND is_admin=0${excludeKeys(internalKeys)}`;
  const raw = (
    await db
      .prepare(
        `SELECT ts, day, user_key AS userKey, session_id AS sessionId, platform, app_version AS appVersion, event, props, country, os, browser, form_factor AS formFactor
         FROM analytics_events WHERE day>=? AND user_key IS NOT NULL ${adminClause} LIMIT ${MAX_ROWS}`,
      )
      .bind(since)
      .all<RawEventRow>()
  ).results;
  const accounts = (
    await db
      .prepare(
        `SELECT lower(email) AS email, first_seen_at AS firstSeen, signup_ref AS ref, signup_src AS src, origin FROM app_users
         ${includeAdmin ? '' : `WHERE lower(email) NOT IN (${INTERNAL_EMAILS})`} LIMIT 5000`,
      )
      .all<{ email: string; firstSeen: string; ref: string | null; src: string | null; origin: string }>()
  ).results;
  const keys = secret ? await userKeys(accounts.map((a) => a.email), secret) : accounts.map(() => '');
  const users: AcquiredUser[] = accounts.map((a, i) => ({ userKey: keys[i], firstDay: pktDay(new Date(a.firstSeen)), ref: a.ref, src: a.src, origin: a.origin }));
  return { ...buildLens(raw.map(parseRow), users, q), generatedAt: now.toISOString(), truncated: raw.length >= MAX_ROWS };
}
