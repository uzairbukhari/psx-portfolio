import { headers } from 'next/headers';
import { env } from 'cloudflare:workers';
import { readCookieValue, verifySession } from '@/lib/session';
import { readBearerToken, verifyMobileToken } from '@/lib/mobile-token';
import { mobileSessionActive } from '@/lib/mobile-sessions';
import { getUserRole, type Role } from '@/lib/roles';

export type AuthUser = {
  email: string;
  name: string | null;
  picture: string | null;
  /** How the request authenticated; native apps use bearer tokens and are not subject to the cookie origin check. */
  via?: 'cookie' | 'bearer' | 'dev';
};
export type Viewer = AuthUser & { role: Role };

const LOGIN_PATH = '/api/auth/google/login';
const LOGOUT_PATH = '/api/auth/logout';
const CALLBACK_PATH = '/api/auth/google/callback';
const SESSION_COOKIE = 'session';

export async function getCurrentUser(): Promise<AuthUser | null> {
  const requestHeaders = await headers();

  const devUser = devAuthUser(requestHeaders.get('host'));
  if (devUser) return { ...devUser, via: 'dev' };

  if (!env.SESSION_SECRET) return null;

  const bearer = readBearerToken(requestHeaders.get('authorization'));
  if (bearer) {
    const mobile = await verifyMobileToken(bearer, env.SESSION_SECRET);
    if (!mobile || !(await mobileSessionActive(mobile.sid, mobile.email))) return null;
    return { email: mobile.email, name: mobile.name, picture: mobile.picture, via: 'bearer' };
  }

  const cookieHeader = requestHeaders.get('cookie');
  if (!cookieHeader) return null;
  const token = readCookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const user = await verifySession(token, env.SESSION_SECRET);
  return user ? { ...user, via: 'cookie' } : null;
}

export async function getViewer(): Promise<Viewer | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { ...user, role: await getUserRole(user.email) };
}

// Local development bypass: skip Google OAuth and act as a fixed user. Both
// conditions must hold — `DEV_AUTH_EMAIL` is only ever set in a git-ignored
// `.dev.vars` (never in `wrangler.jsonc` vars or as a deployed secret), and the
// deployed Worker is never reached on a loopback host — so the deployed app
// keeps requiring a real signed session even if one condition is misconfigured.
function devAuthUser(host: string | null): AuthUser | null {
  const email = env.DEV_AUTH_EMAIL?.trim().toLowerCase();
  if (!email || !isLoopbackHost(host)) return null;
  return { email, name: env.DEV_AUTH_NAME?.trim() || 'Local dev', picture: null };
}

function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const hostname = host
    .replace(/:\d+$/, '')
    .replace(/^\[|\]$/g, '')
    .toLowerCase();
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  );
}

export function signInPath(returnTo: string): string {
  return `${LOGIN_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';

  let url: URL;
  try {
    url = new URL(value, 'https://app.local');
  } catch {
    return '/';
  }
  if (url.origin !== 'https://app.local') return '/';
  if (isReservedAuthPath(url.pathname)) return '/';

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === LOGIN_PATH ||
    pathname === LOGOUT_PATH ||
    pathname === CALLBACK_PATH
  );
}
