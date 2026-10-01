import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { isExpoPushToken } from '@/lib/dividend-push';
import { readBearerToken, verifyMobileToken } from '@/lib/mobile-token';
import { setPushToken } from '@/lib/mobile-sessions';
import { failure, identity } from '@/lib/server';
import { UserError } from '@/lib/user-error';

// The phone registers (PUT) or clears (DELETE) its Expo push token. Only an app bearer token can do this:
// the token is stored on that device's session row, so signing the device out also stops its notifications.
async function currentSession(email: string) {
  const bearer = readBearerToken((await headers()).get('authorization'));
  const mobile = bearer && env.SESSION_SECRET ? await verifyMobileToken(bearer, env.SESSION_SECRET) : null;
  if (!mobile || mobile.email.toLowerCase() !== email.toLowerCase())
    throw new UserError('Push notifications are only available in the phone app.', 400);
  return mobile.sid;
}

export async function PUT(req: Request) {
  try {
    const email = await identity(req, true);
    const sid = await currentSession(email);
    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    if (!isExpoPushToken(body?.token)) throw new UserError('That is not a valid push token.');
    if (!(await setPushToken(sid, email, body.token))) throw new UserError('Session not found.', 404);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(req: Request) {
  try {
    const email = await identity(req, true);
    const sid = await currentSession(email);
    await setPushToken(sid, email, null);
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return failure(e);
  }
}
