import { env } from 'cloudflare:workers';
import { safeRelativeReturnPath } from '@/lib/auth';
import {
  readCookieValue,
  serializeCookie,
  serializeExpiredCookie,
  signSession,
} from '@/lib/session';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cookieHeader = req.headers.get('cookie') ?? '';
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = readCookieValue(cookieHeader, 'oauth_state');
  const returnTo = safeRelativeReturnPath(
    readCookieValue(cookieHeader, 'oauth_return_to') ?? '/',
  );

  if (!code || !state || !expectedState || state !== expectedState)
    return redirectWithError(url.origin, 'oauth_state');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: new URL('/api/auth/google/callback', url.origin).toString(),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) return redirectWithError(url.origin, 'oauth_token');
  const tokens = (await tokenResponse.json()) as { access_token?: string };
  if (!tokens.access_token) return redirectWithError(url.origin, 'oauth_token');

  const userInfoResponse = await fetch(
    'https://openidconnect.googleapis.com/v1/userinfo',
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  if (!userInfoResponse.ok) return redirectWithError(url.origin, 'oauth_userinfo');
  const userInfo = (await userInfoResponse.json()) as {
    email?: string;
    email_verified?: boolean;
  };

  const allowed = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const email = userInfo.email?.toLowerCase();
  if (!userInfo.email_verified || !email)
    return redirectWithError(url.origin, 'oauth_email');
  if (allowed.length && !allowed.includes(email))
    return redirectWithError(url.origin, 'oauth_email');

  if (!env.SESSION_SECRET) return redirectWithError(url.origin, 'oauth_config');
  const sessionToken = await signSession(email, env.SESSION_SECRET);

  const headers = new Headers({
    Location: new URL(returnTo, url.origin).toString(),
  });
  headers.append(
    'Set-Cookie',
    serializeCookie('session', sessionToken, { maxAge: 60 * 60 * 24 * 30 }),
  );
  headers.append('Set-Cookie', serializeExpiredCookie('oauth_state'));
  headers.append('Set-Cookie', serializeExpiredCookie('oauth_return_to'));
  return new Response(null, { status: 302, headers });
}

function redirectWithError(origin: string, code: string): Response {
  return Response.redirect(new URL(`/?error=${code}`, origin).toString(), 302);
}
