import { db, failure, identity } from '@/lib/server';
import { UserError } from '@/lib/user-error';

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
    return Response.json({ sent: results.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}
