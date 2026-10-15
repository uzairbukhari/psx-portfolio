// Push alerts for super admins when something needs a look: a pipeline failing, Cloudflare limit trouble, a spike of
// client errors. Same privacy rule as the dividend push (lib/dividend-push.ts): one generic message that names nothing;
// the admin console shows the details. Each issue is sent at most once per Pakistan day, whatever happens to it later.
import { adminHealth, type AdminHealth, type AdminHealthOptions } from './admin-health.ts';
import { platformReport, type PlatformReport } from './admin-platform.ts';
import { isExpoPushToken, type PushMessage } from './dividend-push.ts';
import { isFcmToken, sendFcm } from './fcm.ts';

export type Alert = { key: string; label: string };
export const ALERT_PUSH = { title: 'Sipwise admin', body: 'Something needs a look in the admin console.' } as const;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const pktDay = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);

/** What is wrong right now, as stable keys (so a repeat the same day is recognised) with a label for the log only. */
export function alertsFrom(health: Pick<AdminHealth, 'pipelines'>, platform: Pick<PlatformReport, 'status' | 'today' | 'connected' | 'server'>, errors: { errors24h: number; errorsPrev24h: number }): Alert[] {
  const out: Alert[] = [];
  for (const p of health.pipelines) if (p.status === 'failing') out.push({ key: `pipeline:${p.id}`, label: `${p.label} is failing` });
  if (platform.today.limitHits > 0) out.push({ key: 'platform:limit', label: 'Cloudflare limit hits' });
  if (platform.connected && platform.today.usedShare >= 0.8) out.push({ key: 'platform:requests', label: 'Requests near the daily limit' });
  if (platform.server.lastHour >= 20) out.push({ key: 'platform:server-errors', label: 'Server errors in the last hour' });
  if (errors.errors24h >= 10 && errors.errors24h >= errors.errorsPrev24h * 2) out.push({ key: 'errors:spike', label: 'Client errors spiking' });
  return out;
}

export function buildAlertPush(tokens: Iterable<string>): PushMessage[] {
  const seen = new Set<string>();
  const out: PushMessage[] = [];
  for (const token of tokens) {
    if (!isExpoPushToken(token) || seen.has(token)) continue;
    seen.add(token);
    out.push({ to: token, ...ALERT_PUSH, data: { kind: 'market-update' }, channelId: 'dividends', sound: 'default' });
  }
  return out;
}

async function clientErrorCounts(db: D1Database, now: Date) {
  const count = async (from: Date, to: Date) => (await db.prepare("SELECT COUNT(*) AS n FROM analytics_events WHERE event='client_error' AND is_admin=0 AND ts>=? AND ts<?")
    .bind(from.toISOString(), to.toISOString()).first<{ n: number }>().catch(() => null))?.n ?? 0;
  const h = 3_600_000;
  return { errors24h: await count(new Date(now.getTime() - 24 * h), new Date(now.getTime() + 1)), errorsPrev24h: await count(new Date(now.getTime() - 48 * h), new Date(now.getTime() - 24 * h)) };
}

/**
 * Looks at the same numbers the admin console shows and pushes one generic message for issues not yet alerted today.
 * Returns what was found and sent. Never throws.
 */
export async function sendAdminAlerts(db: D1Database, opts: AdminHealthOptions & { fcmServiceAccount?: string } = {}, fetcher: typeof fetch = fetch): Promise<{ found: number; fresh: number; sent: number }> {
  const now = opts.now ?? new Date();
  try {
    const [health, platform, errors] = await Promise.all([adminHealth(db, opts), platformReport(db, { ...opts.platform, now }), clientErrorCounts(db, now)]);
    const alerts = alertsFrom(health, platform, errors);
    if (!alerts.length) return { found: 0, fresh: 0, sent: 0 };
    const today = pktDay(now);
    const marks = (await db.prepare("SELECT key,last_attempt_at AS at FROM refresh_state WHERE kind='admin-alert'").all<{ key: string; at: string | null }>()).results;
    const fresh = alerts.filter((a) => !marks.some((m) => m.key === a.key && m.at && pktDay(new Date(m.at)) === today));
    if (!fresh.length) return { found: alerts.length, fresh: 0, sent: 0 };
    const tokens = (await db.prepare(
      `SELECT DISTINCT m.push_token AS token FROM mobile_sessions m JOIN user_roles r ON lower(r.email)=lower(m.email)
       WHERE r.role='super_admin' AND m.revoked_at IS NULL AND m.push_token IS NOT NULL`).all<{ token: string }>()).results.map((r) => r.token);
    const messages = buildAlertPush(tokens);
    const fcmTokens = tokens.filter(isFcmToken);
    if (!messages.length && !fcmTokens.length) return { found: alerts.length, fresh: fresh.length, sent: 0 }; // nobody to tell; try again next time
    let sent = 0;
    if (messages.length) {
      const response = await fetcher(EXPO_PUSH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(messages), signal: AbortSignal.timeout(10_000) });
      if (response.ok) sent += messages.length;
    }
    if (fcmTokens.length) {
      const fcm = await sendFcm(opts.fcmServiceAccount, fcmTokens, ALERT_PUSH, fetcher);
      sent += fcm.sent;
      for (const token of fcm.unregistered) await db.prepare('UPDATE mobile_sessions SET push_token=NULL WHERE push_token=?').bind(token).run().catch(() => {});
    }
    if (!sent) return { found: alerts.length, fresh: fresh.length, sent: 0 };
    const at = now.toISOString();
    await db.batch([
      ...fresh.map((a) => db.prepare(
        `INSERT INTO refresh_state (kind,key,last_attempt_at,last_success_at,failure_count) VALUES ('admin-alert',?,?,?,0)
         ON CONFLICT(kind,key) DO UPDATE SET last_attempt_at=excluded.last_attempt_at, last_success_at=excluded.last_success_at`).bind(a.key, at, at)),
      db.prepare('INSERT INTO admin_actions (at,actor,action,target,result) VALUES (?,?,?,?,?)')
        .bind(at, 'system', 'alert_sent', fresh.map((a) => a.label).join('; ').slice(0, 200), `${sent} phone${sent === 1 ? '' : 's'}`),
    ]);
    return { found: alerts.length, fresh: fresh.length, sent };
  } catch (error) {
    console.error('Admin alerts failed', error);
    return { found: 0, fresh: 0, sent: 0 };
  }
}
