import { headers } from 'next/headers';
import { env } from 'cloudflare:workers';
import { readCookieValue, verifySession } from '@/lib/session';

export type AuthUser = { email: string };

const LOGIN_PATH = '/api/auth/google/login';
const LOGOUT_PATH = '/api/auth/logout';
const CALLBACK_PATH = '/api/auth/google/callback';
const SESSION_COOKIE = 'session';

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!env.SESSION_SECRET) return null;
  const requestHeaders = await headers();
  const cookieHeader = requestHeaders.get('cookie');
  if (!cookieHeader) return null;
  const token = readCookieValue(cookieHeader, SESSION_COOKIE);
  if (!token) return null;
  const email = await verifySession(token, env.SESSION_SECRET);
  return email ? { email } : null;
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
