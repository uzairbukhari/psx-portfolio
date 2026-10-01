import { env } from 'cloudflare:workers';
import type { MobileSignInRequest, MobileSignInResponse } from '@/lib/api-types';
import { emailAllowed, parseList, verifyGoogleIdToken } from '@/lib/google-id-token';
import { signMobileToken } from '@/lib/mobile-token';
import { createMobileSession } from '@/lib/mobile-sessions';
import { failure } from '@/lib/server';
import { UserError } from '@/lib/user-error';
import { readLimited } from '@/lib/read-limited';
import { getUserRole } from '@/lib/roles';

// Native sign-in: the app gets a Google ID token from the Google Sign-In SDK and
// exchanges it here for an app token tied to a revocable device session.
export async function POST(req: Request) {
  try {
    const audiences = parseList(env.GOOGLE_MOBILE_CLIENT_IDS);
    if (!audiences.length || !env.SESSION_SECRET)
      throw new UserError('Mobile sign-in is not configured.', 503);
    const bytes = await readLimited(req, 16_000, 'Request is too large.');
    const body = JSON.parse(new TextDecoder().decode(bytes)) as Partial<MobileSignInRequest>;
    if (typeof body.idToken !== 'string' || !body.idToken)
      throw new UserError('Missing Google ID token.');
    const identity = await verifyGoogleIdToken(body.idToken, audiences);
    if (!identity || !emailAllowed(identity.email, env.ALLOWED_EMAILS))
      throw new UserError('Google sign-in was not accepted.', 401);
    const sid = await createMobileSession(identity.email, body.deviceName, body.platform);
    const token = await signMobileToken({ ...identity, sid }, env.SESSION_SECRET);
    return Response.json(
      {
        token,
        user: { ...identity, role: await getUserRole(identity.email) },
      } satisfies MobileSignInResponse,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return failure(e);
  }
}
