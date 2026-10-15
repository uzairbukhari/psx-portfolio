import { env } from 'cloudflare:workers';
import { isFcmToken, sendFcm } from '@/lib/fcm';
import { db, failure, identity } from '@/lib/server';
import { UserError } from '@/lib/user-error';

type Ticket = { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } };

const describeError = (t: Ticket) => {
  const code = t.details?.error;
  if (code === 'InvalidCredentials')
    return 'Expo could not reach Google Firebase for this app: the FCM V1 service account key is missing or wrong (eas credentials, Android, staging).';
  if (code === 'DeviceNotRegistered') return 'This phone is no longer registered. Turn notifications off and on again in the app.';
  return `Notification failed: ${t.message ?? code ?? 'unknown error'}`;
};

// Sends a test notification to the caller's own registered phones, so push can be checked end to end.
export async function POST(req: Request) {
  try {
    const email = await identity(req, true);
    const { results } = await db()
      .prepare('SELECT push_token AS token FROM mobile_sessions WHERE email=? AND revoked_at IS NULL AND push_token IS NOT NULL')
      .bind(email.toLowerCase())
      .all<{ token: string }>();
    if (!results.length) throw new UserError('No phone is registered for notifications yet. Turn them on in the app first.', 400);
    const title = 'Sipwise test';
    const body = 'Notifications are working. Dividend announcements for your companies will arrive like this.';
    const fcmTokens = results.map((r) => r.token).filter(isFcmToken);
    const expoRows = results.filter((r) => !isFcmToken(r.token));
    let delivered = 0;
    if (fcmTokens.length) {
      const fcm = await sendFcm((env as { FCM_SERVICE_ACCOUNT_JSON?: string }).FCM_SERVICE_ACCOUNT_JSON, fcmTokens, { title, body, kind: 'test' });
      for (const token of fcm.unregistered) await db().prepare('UPDATE mobile_sessions SET push_token=NULL WHERE push_token=?').bind(token).run();
      if (fcm.unregistered.length) throw new UserError('This phone is no longer registered. Turn notifications off and on again in the app.', 502);
      if (fcm.error) throw new UserError(`Notification failed: ${fcm.error}`, 502);
      delivered += fcm.sent;
    }
    if (!expoRows.length) return Response.json({ sent: delivered }, { headers: { 'Cache-Control': 'no-store' } });
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        expoRows.map(({ token }) => ({
          to: token,
          title,
          body,
          channelId: 'dividends',
          sound: 'default',
        })),
      ),
    });
    if (!response.ok) throw new UserError('The notification service did not accept the test. Try again shortly.', 502);
    // HTTP 200 only means Expo queued the message; delivery errors (bad FCM credentials, a stale token)
    // come back per message, first as tickets and then as receipts.
    const tickets = ((await response.json().catch(() => null)) as { data?: Ticket[] } | null)?.data ?? [];
    const failed = tickets.find((t) => t.status === 'error');
    if (failed) throw new UserError(describeError(failed), 502);
    const ids = tickets.flatMap((t) => (t.id ? [t.id] : []));
    if (ids.length) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const receipts = await fetch('https://exp.host/--/api/v2/push/getReceipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids }),
      })
        .then((r) => r.json() as Promise<{ data?: Record<string, Ticket> }>)
        .catch(() => null);
      const bad = Object.values(receipts?.data ?? {}).find((t) => t.status === 'error');
      if (bad) throw new UserError(describeError(bad), 502);
    }
    return Response.json({ sent: delivered + expoRows.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e, undefined, req);
  }
}
