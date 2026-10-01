import { env } from 'cloudflare:workers';
import { UserError } from '@/lib/user-error';

export type MobileSession = {
  id: string;
  deviceName: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
};

const LAST_SEEN_GRANULARITY_MS = 60 * 60 * 1000;

export function cleanDeviceName(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
  return (text || 'Phone').slice(0, 60);
}

export function cleanPlatform(value: unknown): 'ios' | 'android' | 'other' {
  return value === 'ios' || value === 'android' ? value : 'other';
}

export async function createMobileSession(
  email: string,
  deviceName: unknown,
  platform: unknown,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      'INSERT INTO mobile_sessions (id,email,device_name,platform,created_at,last_seen_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(id, email.toLowerCase(), cleanDeviceName(deviceName), cleanPlatform(platform), now, now)
    .run();
  return id;
}

/**
 * True while the device session exists, belongs to the email and is not revoked. A failed lookup
 * (for example a transient D1 error) throws a 503 instead of answering false: false means "revoked"
 * and makes the phone delete its token, which a database hiccup must never do.
 */
export async function mobileSessionActive(sid: string, email: string): Promise<boolean> {
  try {
    const row = await env.DB
      .prepare('SELECT revoked_at AS revokedAt, last_seen_at AS lastSeenAt FROM mobile_sessions WHERE id=? AND email=?')
      .bind(sid, email.toLowerCase())
      .first<{ revokedAt: string | null; lastSeenAt: string }>();
    if (!row || row.revokedAt) return false;
    if (Date.now() - Date.parse(row.lastSeenAt) > LAST_SEEN_GRANULARITY_MS) {
      await env.DB
        .prepare('UPDATE mobile_sessions SET last_seen_at=? WHERE id=?')
        .bind(new Date().toISOString(), sid)
        .run()
        .catch(() => {});
    }
    return true;
  } catch (e) {
    console.error('mobile session lookup failed', e);
    throw new UserError('Could not check your sign-in right now. Try again in a moment.', 503);
  }
}

export async function listMobileSessions(email: string): Promise<MobileSession[]> {
  const { results } = await env.DB
    .prepare(
      'SELECT id, device_name AS deviceName, platform, created_at AS createdAt, last_seen_at AS lastSeenAt FROM mobile_sessions WHERE email=? AND revoked_at IS NULL ORDER BY last_seen_at DESC',
    )
    .bind(email.toLowerCase())
    .all<MobileSession>();
  return results;
}

/** Stores (or clears, with null) the Expo push token for one active device session. */
export async function setPushToken(sid: string, email: string, token: string | null): Promise<boolean> {
  const result = await env.DB
    .prepare('UPDATE mobile_sessions SET push_token=? WHERE id=? AND email=? AND revoked_at IS NULL')
    .bind(token, sid, email.toLowerCase())
    .run();
  return result.meta.changes > 0;
}

export async function revokeMobileSession(email: string, id: string): Promise<boolean> {
  const result = await env.DB
    .prepare('UPDATE mobile_sessions SET revoked_at=?, push_token=NULL WHERE id=? AND email=? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), id, email.toLowerCase())
    .run();
  return result.meta.changes > 0;
}
