import { headers } from 'next/headers';
import { env } from 'cloudflare:workers';
import { readCookieValue, verifySession } from '@/lib/session';

export type AuthUser = { email: string; name: string | null };

const LOGIN_PATH = '/api/auth/google/login';
const LOGOUT_PATH = '/api/auth/logout';
const CALLBACK_PATH = '/api/auth/google/callback';
const SESSION_COOKIE = 'session';

export async function getCurrentUser(): Promise<AuthUser | null> {
  const requestHeaders = await headers();

  const devUser = devAuthUser(requestHeaders.get('host'));
  if (devUser) return devUser;

  if (!env.SESSION_SECRET) return null;
  const cookieHeader = requestHeaders.get('cookie');
  if (!cookieHeader) return null;
  const token = readCookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  return verifySession(token, env.SESSION_SECRET);
}

// Local development bypass: skip Google OAuth and act as a fixed user. Both
// conditions must hold — `DEV_AUTH_EMAIL` is only ever set in a git-ignored
// `.dev.vars` (never in `wrangler.jsonc` vars or as a deployed secret), and the
// deployed Worker is never reached on a loopback host — so the deployed app
// keeps requiring a real signed session even if one condition is misconfigured.
function devAuthUser(host: string | null): AuthUser | null {
  const email = env.DEV_AUTH_EMAIL?.trim().toLowerCase();
  if (!email || !isLoopbackHost(host)) return null;
  return { email, name: env.DEV_AUTH_NAME?.trim() || 'Local dev' };
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
