// Sign-in for the fictional test account on the STAGING Worker only, so automated tests can get past Google OAuth.
// Disabled (404) unless APP_ENV is "staging" AND the TEST_LOGIN_SECRET Worker secret is set. It can only ever sign in
// TEST_ACCOUNT_EMAIL, so it grants no access to a real user's session.
import { signSession } from './session.ts';
import { takeRateLimit } from './rate-limit.ts';
import { TEST_ACCOUNT_EMAIL, TEST_ACCOUNT_NAME } from './test-account.ts';

export const TEST_LOGIN_PATH = '/api/auth/test-login';
export const TEST_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const ATTEMPTS = { windowMs: 10 * 60 * 1000, max: 20 };

export type TestLoginEnv = { APP_ENV?: string; TEST_LOGIN_SECRET?: string; SESSION_SECRET?: string };
type Db = Parameters<typeof takeRateLimit>[0];

export const testLoginEnabled = (env: TestLoginEnv) =>
  env.APP_ENV === 'staging' && Boolean(env.TEST_LOGIN_SECRET) && Boolean(env.SESSION_SECRET);

/** Constant-time comparison of two strings (hash first so lengths do not leak). */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const xa = new Uint8Array(x);
  const ya = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
  return diff === 0;
}

const notFound = () => new Response('Not found', { status: 404 });

export function testLoginForm(): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test sign-in</title>
<body style="font-family:system-ui;max-width:24rem;margin:4rem auto;padding:0 1rem">
<h1>Staging test sign-in</h1><p>Signs in as the fictional test account only.</p>
<form method="post" action="${TEST_LOGIN_PATH}"><label>Secret <input type="password" name="secret" autofocus required></label> <button type="submit">Sign in</button></form></body>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function handleTestLogin(req: Request, env: TestLoginEnv, db: Db): Promise<Response> {
  if (!testLoginEnabled(env)) return notFound();
  if (req.method === 'GET') return testLoginForm();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (req.headers.get('origin') && req.headers.get('origin') !== new URL(req.url).origin)
    return new Response('Invalid request origin.', { status: 403 });

  const decision = await takeRateLimit(db, 'test-login', 'test-login', ATTEMPTS);
  if (!decision.allowed) return new Response('Too many attempts.', { status: 429 });

  const type = req.headers.get('content-type') ?? '';
  let given = '';
  if (type.includes('application/json')) {
    const body = (await req.json().catch(() => null)) as { secret?: unknown } | null;
    if (typeof body?.secret === 'string') given = body.secret;
  } else {
    const field = (await req.formData().catch(() => null))?.get('secret');
    if (typeof field === 'string') given = field;
  }
  given = given || (req.headers.get('x-test-login-secret') ?? '');
  if (!given || !(await secretsMatch(given, env.TEST_LOGIN_SECRET as string))) return new Response('Wrong secret.', { status: 401 });

  const token = await signSession(TEST_ACCOUNT_EMAIL, TEST_ACCOUNT_NAME, env.SESSION_SECRET as string, TEST_SESSION_TTL_MS);
  const headers = new Headers({
    'Set-Cookie': `session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TEST_SESSION_TTL_MS / 1000}`,
    'Cache-Control': 'no-store',
  });
  if (type.includes('application/json')) {
    headers.set('Content-Type', 'application/json');
    return new Response(JSON.stringify({ email: TEST_ACCOUNT_EMAIL }), { headers });
  }
  headers.set('Location', '/');
  return new Response(null, { status: 303, headers });
}
