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
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(
        results.map(({ token }) => ({
          to: token,
          title: 'Sipwise test',
          body: 'Notifications are working. Dividend announcements for your companies will arrive like this.',
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
    return Response.json({ sent: results.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}
