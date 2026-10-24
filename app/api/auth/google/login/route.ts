import { env } from 'cloudflare:workers';
import { safeRelativeReturnPath } from '@/lib/auth';
import { parseSignupRef, parseSignupSource } from '@/lib/hosts';
import { serializeCookie } from '@/lib/session';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = safeRelativeReturnPath(url.searchParams.get('return_to') ?? '/');
  const state = crypto.randomUUID();

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID ?? '');
  authUrl.searchParams.set(
    'redirect_uri',
    new URL('/api/auth/google/callback', url.origin).toString(),
  );
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);

  const headers = new Headers({ Location: authUrl.toString() });
  headers.append('Set-Cookie', serializeCookie('oauth_state', state, { maxAge: 300 }));
  headers.append(
    'Set-Cookie',
    serializeCookie('oauth_return_to', returnTo, { maxAge: 300 }),
  );
  // Which marketing button sent the visitor (closed list); kept only until the callback records it for a new account.
  const src = parseSignupSource(url.searchParams.get('src'));
  if (src) headers.append('Set-Cookie', serializeCookie('oauth_src', src, { maxAge: 300 }));
  // Which social channel sent the visitor (closed list); marketing.js adds it to the sign-in links.
  const ref = parseSignupRef(url.searchParams.get('ref'));
  if (ref) headers.append('Set-Cookie', serializeCookie('oauth_ref', ref, { maxAge: 300 }));
  return new Response(null, { status: 302, headers });
}
