# Standalone Cloudflare Deployment with Google OAuth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the OpenAI Sites / ChatGPT-header auth integration entirely and replace it with Google OAuth sign-in (restricted to an email allowlist) so the app can be deployed to the user's own Cloudflare account.

**Architecture:** A stateless, signed session cookie (HMAC-SHA256, no D1 table) replaces ChatGPT's request-header identity. New `/api/auth/google/{login,callback}` and `/api/auth/logout` route handlers implement the OAuth authorization-code flow, verifying the user's email against a comma-separated allowlist before issuing a session. `lib/server.ts#identity()` is the single call site that changes to consume the new `lib/auth.ts#getCurrentUser()` instead of the old ChatGPT header reader — everything downstream (D1 queries, API routes) is unaffected because it only ever consumed a `userId` string.

**Tech Stack:** Existing stack unchanged — vinext, Cloudflare Workers (`cloudflare:workers` env bindings), D1 via Drizzle, Web Crypto (`crypto.subtle`) for HMAC signing (no new dependency), `node:test` for logic tests.

**Spec:** `docs/superpowers/specs/2026-09-16-standalone-google-auth-design.md`

## Global Constraints

- No new npm dependencies — session signing uses the Workers/Node-native `crypto.subtle` and `Buffer` (already available via the `nodejs_compat` compatibility flag already set in `wrangler.jsonc`).
- No new D1 tables or schema changes — sessions are stateless signed cookies, not server-side records.
- `identity()`'s existing contract (throws `Error('Sign in to access your portfolio.')` when unauthenticated, throws `Error('Invalid request origin.')` on cross-origin writes, otherwise returns a stable string `userId`) must not change — every API route depends on it unchanged.
- `ALLOWED_EMAILS` comparison is case-insensitive with entries trimmed of whitespace.
- Every real secret (`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `OPENAI_API_KEY`) is set via `wrangler secret put`, never committed; `wrangler.jsonc` only ever holds non-secret plain vars (`ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`) and those ship as empty strings by default (empty `ALLOWED_EMAILS` denies everyone — a safe default, never an open allow-all).
- `oxlint`'s `correctness` category is treated as an error project-wide (see `.oxlintrc.json` / CLAUDE.md) — new code must pass `npm run lint`.

---

## Task 1: Session cookie signing and cookie-header helpers

**Files:**
- Create: `lib/session.ts`
- Test: `tests/session.test.mjs`

**Interfaces:**
- Produces: `signSession(email: string, secret: string, ttlMs?: number): Promise<string>`, `verifySession(token: string, secret: string): Promise<string | null>`, `serializeCookie(name: string, value: string, opts: { maxAge: number }): string`, `serializeExpiredCookie(name: string): string`, `readCookieValue(cookieHeader: string, name: string): string | null`.

This task is pure logic with no Cloudflare/Next.js dependency, so it's fully covered by `node:test` (matches how `tests/portfolio.test.mjs` tests `lib/portfolio.ts` directly, importing the `.ts` file — Node 22's native TypeScript stripping runs it without a build step).

- [ ] **Step 1: Write the failing tests**

Create `tests/session.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  signSession,
  verifySession,
  serializeCookie,
  serializeExpiredCookie,
  readCookieValue,
} from '../lib/session.ts';

test('a signed session round-trips to the original email', async () => {
  const token = await signSession('owner@example.com', 'test-secret');
  assert.equal(await verifySession(token, 'test-secret'), 'owner@example.com');
});

test('a tampered payload is rejected', async () => {
  const token = await signSession('owner@example.com', 'test-secret');
  const [, signature] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ email: 'attacker@example.com', exp: Date.now() + 100000 }),
  ).toString('base64url');
  assert.equal(
    await verifySession(`${forgedPayload}.${signature}`, 'test-secret'),
    null,
  );
});

test('a tampered signature is rejected', async () => {
  const token = await signSession('owner@example.com', 'test-secret');
  const [payload] = token.split('.');
  assert.equal(await verifySession(`${payload}.deadbeef`, 'test-secret'), null);
});

test('the wrong secret is rejected', async () => {
  const token = await signSession('owner@example.com', 'test-secret');
  assert.equal(await verifySession(token, 'wrong-secret'), null);
});

test('an expired session is rejected', async () => {
  const token = await signSession('owner@example.com', 'test-secret', -1000);
  assert.equal(await verifySession(token, 'test-secret'), null);
});

test('malformed tokens are rejected without throwing', async () => {
  assert.equal(await verifySession('not-a-token', 'test-secret'), null);
  assert.equal(await verifySession('', 'test-secret'), null);
});

test('serializeCookie sets HttpOnly, Secure, SameSite=Lax and the given Max-Age', () => {
  const header = serializeCookie('session', 'abc123', { maxAge: 60 });
  assert.match(header, /^session=abc123;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /Secure/);
  assert.match(header, /SameSite=Lax/);
  assert.match(header, /Max-Age=60/);
});

test('serializeExpiredCookie clears the cookie with Max-Age=0', () => {
  assert.match(serializeExpiredCookie('session'), /Max-Age=0/);
});

test('readCookieValue finds a named cookie among several', () => {
  const header = 'a=1; session=abc%20123; b=2';
  assert.equal(readCookieValue(header, 'session'), 'abc 123');
  assert.equal(readCookieValue(header, 'missing'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/session.test.mjs`
Expected: FAIL — `lib/session.ts` does not exist yet (module not found).

- [ ] **Step 3: Implement `lib/session.ts`**

```ts
const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(
  email: string,
  secret: string,
  ttlMs = 30 * 24 * 60 * 60 * 1000,
): Promise<string> {
  const payload = Buffer.from(
    JSON.stringify({ email, exp: Date.now() + ttlMs }),
  ).toString('base64url');
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${Buffer.from(signature).toString('base64url')}`;
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<string | null> {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const key = await hmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      Buffer.from(signature, 'base64url'),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      email?: string;
      exp?: number;
    };
    if (!data.email || typeof data.exp !== 'number' || data.exp < Date.now())
      return null;
    return data.email;
  } catch {
    return null;
  }
}

export function serializeCookie(
  name: string,
  value: string,
  { maxAge }: { maxAge: number },
): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function serializeExpiredCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/session.test.mjs`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/session.ts tests/session.test.mjs
git commit -m "$(cat <<'EOF'
Add stateless signed session cookie helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Env type declarations for the new auth config

**Files:**
- Modify: `db/env.d.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Cloudflare.Env.ALLOWED_EMAILS?: string`, `.GOOGLE_CLIENT_ID?: string`, `.GOOGLE_CLIENT_SECRET?: string`, `.SESSION_SECRET?: string` — later tasks read these via `env.*` from `cloudflare:workers`.

- [ ] **Step 1: Add the declarations**

Current file:

```ts
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}
declare namespace Cloudflare {
  interface Env {
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
  }
}
```

Add a third block:

```ts
declare namespace Cloudflare {
  interface Env {
    ALLOWED_EMAILS?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    SESSION_SECRET?: string;
  }
}
```

- [ ] **Step 2: Verify types still check**

Run: `npx tsc --noEmit`
Expected: no new errors (these are additive optional fields).

- [ ] **Step 3: Commit**

```bash
git add db/env.d.ts
git commit -m "$(cat <<'EOF'
Declare Cloudflare env vars for Google OAuth and session signing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Auth abstraction (`lib/auth.ts`)

**Files:**
- Create: `lib/auth.ts`
- Delete: `app/chatgpt-auth.ts` (its logic is fully superseded — `getChatGPTUser`/header reading is replaced by session-cookie reading, and `requireChatGPTUser`/`chatGPTSignInPath`/`chatGPTSignOutPath` were unused dead code, confirmed by a repo-wide grep before this plan was written)

**Interfaces:**
- Consumes: `verifySession`, `readCookieValue` from `lib/session.ts` (Task 1); `env.SESSION_SECRET` (Task 2).
- Produces: `getCurrentUser(): Promise<{ email: string } | null>`, `signInPath(returnTo: string): string`, `safeRelativeReturnPath(value: string): string` (exported — Task 4's routes reuse it to validate `return_to` before storing it).

- [ ] **Step 1: Write `lib/auth.ts`**

```ts
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
    pathname === LOGIN_PATH || pathname === LOGOUT_PATH || pathname === CALLBACK_PATH
  );
}
```

Note: `signOutPath` from the old module is not carried over — no code called it (confirmed dead code), and Task 5's logout route is linked to directly by path, matching how `app/portfolio.tsx` already links to auth paths as literal strings today.

- [ ] **Step 2: Delete the superseded module**

```bash
git rm app/chatgpt-auth.ts
```

- [ ] **Step 3: Confirm nothing else references the deleted module**

Run: `grep -rn "chatgpt-auth" --include="*.ts" --include="*.tsx" .` (excluding `node_modules`)
Expected: no matches outside this plan/spec's own prose.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: fails right now with an error in `lib/server.ts` (still imports the deleted module) — that's expected and fixed in Task 6. Confirm the *only* error is that one import.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts
git add -u app/chatgpt-auth.ts
git commit -m "$(cat <<'EOF'
Replace ChatGPT header auth with a session-cookie auth abstraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Google OAuth routes (login, callback, logout)

**Files:**
- Create: `app/api/auth/google/login/route.ts`
- Create: `app/api/auth/google/callback/route.ts`
- Create: `app/api/auth/logout/route.ts`

**Interfaces:**
- Consumes: `safeRelativeReturnPath` from `lib/auth.ts` (Task 3); `signSession`, `serializeCookie`, `serializeExpiredCookie`, `readCookieValue` from `lib/session.ts` (Task 1); `env.GOOGLE_CLIENT_ID`, `env.GOOGLE_CLIENT_SECRET`, `env.SESSION_SECRET`, `env.ALLOWED_EMAILS` (Task 2).
- Produces: the three HTTP endpoints Task 5's UI link targets.

No automated test here — this task is a live integration with Google's OAuth endpoints and can't be meaningfully unit-tested without a real or mocked Google account (matches this codebase's existing pattern of not testing UI/network-integration routes, per `README.md`'s Validation section and CLAUDE.md's testing note). It's verified manually in Task 8.

- [ ] **Step 1: Write the login route**

`app/api/auth/google/login/route.ts`:

```ts
import { env } from 'cloudflare:workers';
import { safeRelativeReturnPath } from '@/lib/auth';
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
  authUrl.searchParams.set('scope', 'openid email');
  authUrl.searchParams.set('state', state);

  const headers = new Headers({ Location: authUrl.toString() });
  headers.append('Set-Cookie', serializeCookie('oauth_state', state, { maxAge: 300 }));
  headers.append(
    'Set-Cookie',
    serializeCookie('oauth_return_to', returnTo, { maxAge: 300 }),
  );
  return new Response(null, { status: 302, headers });
}
```

- [ ] **Step 2: Write the callback route**

`app/api/auth/google/callback/route.ts`:

```ts
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
  if (!userInfo.email_verified || !email || !allowed.includes(email))
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
```

- [ ] **Step 3: Write the logout route**

`app/api/auth/logout/route.ts`:

```ts
import { safeRelativeReturnPath } from '@/lib/auth';
import { serializeExpiredCookie } from '@/lib/session';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const returnTo = safeRelativeReturnPath(url.searchParams.get('return_to') ?? '/');
  const headers = new Headers({
    Location: new URL(returnTo, url.origin).toString(),
  });
  headers.append('Set-Cookie', serializeExpiredCookie('session'));
  return new Response(null, { status: 302, headers });
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: still only the one pre-existing `lib/server.ts` error from Task 3 (fixed next in Task 6) — no new errors from these three new files.

- [ ] **Step 5: Commit**

```bash
git add app/api/auth
git commit -m "$(cat <<'EOF'
Add Google OAuth login, callback and logout routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire `lib/server.ts` to the new auth abstraction

**Files:**
- Modify: `lib/server.ts:1-9`

**Interfaces:**
- Consumes: `getCurrentUser` from `lib/auth.ts` (Task 3).
- Produces: `identity(req, write?)` keeps its exact existing contract (return type, thrown error messages) — every API route (`app/api/**/route.ts`) depends on this being unchanged.

- [ ] **Step 1: Update the import and the call site**

Change:

```ts
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
export async function identity(req: Request, write = false) {
  const user = await getChatGPTUser();
  if (!user) throw Error('Sign in to access your portfolio.');
  if (write && req.headers.get('origin') !== new URL(req.url).origin)
    throw Error('Invalid request origin.');
  return user.userId;
}
```

to:

```ts
import { env } from 'cloudflare:workers';
import { getCurrentUser } from '@/lib/auth';
export async function identity(req: Request, write = false) {
  const user = await getCurrentUser();
  if (!user) throw Error('Sign in to access your portfolio.');
  if (write && req.headers.get('origin') !== new URL(req.url).origin)
    throw Error('Invalid request origin.');
  return user.email;
}
```

`db()` and `failure()` in the same file are unchanged.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS, zero errors — this was the last dangling reference to the deleted `app/chatgpt-auth.ts`.

- [ ] **Step 3: Run the full existing test suite**

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS — all existing test files plus `tests/session.test.mjs` green (this task doesn't touch calculation logic, so the others should be unaffected; run them to confirm no accidental breakage). Note: `node --test tests/` (a bare directory, no glob) fails with `MODULE_NOT_FOUND` on this project's Node version — always use the glob form.

- [ ] **Step 4: Commit**

```bash
git add lib/server.ts
git commit -m "$(cat <<'EOF'
Point identity() at the Google-OAuth-backed auth abstraction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update the sign-in link in the UI

**Files:**
- Modify: `app/portfolio.tsx:326-328`

**Interfaces:**
- Consumes: nothing new (static link change only).

- [ ] **Step 1: Replace the ChatGPT sign-in link**

Change:

```tsx
            <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
              Sign in with ChatGPT →
            </a>
```

to:

```tsx
            <a href="/api/auth/google/login?return_to=%2F" target="_top">
              Sign in with Google →
            </a>
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/portfolio.tsx
git commit -m "$(cat <<'EOF'
Point the sign-in link at Google OAuth instead of ChatGPT

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Remove the OpenAI Sites integration from the build

**Files:**
- Modify: `vite.config.ts`
- Modify: `wrangler.jsonc`
- Delete: `.openai/hosting.json` (and the now-empty `.openai/` directory)
- Modify: `package.json` (remove `@openai/sites-vite-plugin` from `devDependencies`)

**Interfaces:**
- Consumes: nothing.
- Produces: a build (`npm run build`) whose output `dist/server/wrangler.json` sources its D1 binding from `wrangler.jsonc` alone (no duplicate/competing binding from the vite config), and no longer requires `.openai/hosting.json` to exist.

This exact config was hand-verified against a real build before writing this plan (removing `sites()` while dropping the inline `d1_databases` from the vite plugin's `config` avoids the duplicate-binding problem that a naive removal would hit — see the spec's "Removed" section). Reproduce that verified end state exactly.

- [ ] **Step 1: Rewrite `vite.config.ts`**

```ts
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
```

Note: the D1 binding (`d1_databases`) is deliberately *not* declared here anymore — it now comes solely from `wrangler.jsonc` (next step), which `@cloudflare/vite-plugin` auto-discovers. Declaring it in both places produced two competing `"binding": "DB"` entries in the build output (confirmed while preparing this plan).

- [ ] **Step 2: Update `wrangler.jsonc`**

Current:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "psx-portfolio-sip",
  "compatibility_date": "2026-05-22",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "site-creator-d1",
      "database_id": "00000000-0000-4000-8000-000000000000",
      "migrations_dir": "drizzle"
    }
  ]
}
```

Replace with:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "psx-portfolio-sip",
  "compatibility_date": "2026-05-22",
  "d1_databases": [
    {
      "binding": "DB",
      // Placeholder — after `wrangler d1 create psx-portfolio-sip`,
      // replace with the real database_id it prints.
      "database_name": "psx-portfolio-sip",
      "database_id": "00000000-0000-4000-8000-000000000000",
      "migrations_dir": "drizzle"
    }
  ],
  "vars": {
    // Comma-separated list of Google account emails allowed to sign in.
    // Empty denies everyone — fill this in before deploying.
    "ALLOWED_EMAILS": "",
    // Public OAuth client ID from Google Cloud Console (not a secret).
    "GOOGLE_CLIENT_ID": ""
  }
}
```

- [ ] **Step 3: Delete the Sites hosting manifest**

```bash
git rm .openai/hosting.json
rmdir .openai 2>/dev/null || true
```

- [ ] **Step 4: Remove the now-unused dependency**

Edit `package.json`, remove this line from `devDependencies`:

```json
    "@openai/sites-vite-plugin": "0.2.0",
```

Then run: `npm install`
Expected: `package-lock.json` updates to drop the dependency; no other changes.

- [ ] **Step 5: Verify the build**

```bash
rm -rf dist
npm run build
```

Expected: build succeeds (same "Build complete" output as before). Then confirm the binding is singular and sourced correctly:

```bash
python3 -c "import json; d=json.load(open('dist/server/wrangler.json')); print(d['d1_databases']); print(d['vars'])"
```

Expected: exactly one `d1_databases` entry (`database_name: "psx-portfolio-sip"`), and `vars` containing `ALLOWED_EMAILS` / `GOOGLE_CLIENT_ID` (empty strings at this point — real values are filled in at deploy time in Task 8).

- [ ] **Step 6: Run the full test and type-check suite once more**

```bash
npx tsc --noEmit
node --test 'tests/*.test.mjs'
npm run lint
```

Expected: `tsc` and tests PASS cleanly. `npm run lint` has pre-existing failures unrelated to this work (confirmed while executing this plan: 25 errors, all in files this plan never touches — shadcn UI components under `components/ui/`, `lib/portfolio.ts:439`, `components/ui/chart.tsx`). The bar here is zero *new* lint errors from this plan's files, not a clean `npm run lint` overall — diff the error list against that pre-existing baseline rather than expecting it to pass outright.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts wrangler.jsonc package.json package-lock.json
git rm -r --cached .openai 2>/dev/null || true
git commit -m "$(cat <<'EOF'
Remove OpenAI Sites build integration in favor of a standalone Cloudflare deploy

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Update documentation

**Files:**
- Modify: `README.md` (the "Development & deployment" section, lines 27–35)
- Modify: `CLAUDE.md` (the "What this is" and "Auth" paragraphs)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Rewrite `README.md`'s "Development & deployment" section**

Replace:

```markdown
- Node >=22.13; install with npm and preserve package-lock.json.
- Before the first local run, execute `npm run db:migrate:local` once to create the local D1 tables. Then `npm run dev` starts the Vinext preview. Local sign-in uses the starter's `/signin-with-chatgpt` flow.
- `node --test tests/portfolio.test.mjs` checks cost accounting, sales, missing data, dates, monthly budgets, allocation limits and AI weights.
- `npx tsc --noEmit` checks types; `npm run build` builds the Cloudflare Worker.
- D1 schema is in `db/schema.ts`; generate append-only migrations with `npm run db:generate`. Apply local migrations using Wrangler with `--local --persist-to .wrangler/state`; production migrations are managed by Sites deployment.
- `.env.local` is ignored; `OPENAI_API_KEY` is a server-side secret. Never put a key in a public variable, source file, hosting manifest or bundle. Hosted secrets are configured through Sites.
- API requests require ChatGPT identity and writes require same-origin requests. Per-user data is isolated with revision checks to reject concurrent stale saves.
```

with:

```markdown
- Node >=22.13; install with npm and preserve package-lock.json.
- Before the first local run, execute `npm run db:migrate:local` once to create the local D1 tables. Then `npm run dev` starts the Vinext preview.
- `node --test 'tests/*.test.mjs'` runs all tests: portfolio cost accounting, sales, missing data, dates, monthly budgets, allocation limits and AI weights (`tests/portfolio.test.mjs`), plus session cookie signing/verification (`tests/session.test.mjs`).
- `npx tsc --noEmit` checks types; `npm run build` builds the Cloudflare Worker.
- D1 schema is in `db/schema.ts`; generate append-only migrations with `npm run db:generate`. Apply local migrations with `--local --persist-to .wrangler/state`; apply them to your own deployed database with `wrangler d1 migrations apply DB --remote`.
- This is a standalone Cloudflare Worker deployment (`wrangler deploy`) in your own Cloudflare account — no external hosting platform is involved. Secrets (`OPENAI_API_KEY`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`) are set with `wrangler secret put <NAME>`, never committed. Non-secret config (`ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`) lives in `wrangler.jsonc`'s `vars`.
- API requests require a signed-in Google account whose email is in `ALLOWED_EMAILS`; writes also require same-origin requests. Per-user data is isolated with revision checks to reject concurrent stale saves.
```

- [ ] **Step 2: Update `CLAUDE.md`**

In the "What this is" paragraph, change:

> ...built as an **OpenAI Sites** app: Next.js App Router code executed by **vinext** ... deployed as a **Cloudflare Worker** ... via Drizzle ORM. Auth identity comes from ChatGPT (`oai-authenticated-user-*` headers), not a custom login system.

to:

> ...built with Next.js App Router code executed by **vinext** ... deployed as a **Cloudflare Worker** in the owner's own Cloudflare account, with a **D1** (SQLite) database via Drizzle ORM. Auth is Google OAuth sign-in restricted to an email allowlist (`ALLOWED_EMAILS`), not a custom accounts system.

In the "Auth" bullet under Architecture, change:

> **Auth**: `app/chatgpt-auth.ts` reads ChatGPT identity from request headers (no session cookies/JWT of our own). `getChatGPTUser()` / `requireChatGPTUser()` are the only ways to get the current user server-side. `lib/server.ts#identity()` wraps this for API routes and also enforces same-origin on writes.

to:

> **Auth**: `lib/auth.ts#getCurrentUser()` verifies a stateless, HMAC-signed session cookie (`lib/session.ts`) set by the Google OAuth flow (`app/api/auth/google/{login,callback}/route.ts`), checking the signed-in email against `ALLOWED_EMAILS`. `lib/server.ts#identity()` wraps this for API routes and also enforces same-origin on writes.

Also remove the now-inaccurate sentence in the Routing/runtime bullet about reserved ChatGPT auth paths (`/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`) — those paths are no longer reserved or meaningful; the new reserved paths are `/api/auth/google/login`, `/api/auth/google/callback`, `/api/auth/logout`.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "$(cat <<'EOF'
Update docs for the standalone Google OAuth deployment

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Manual deployment runbook (user-run, not automated)

**Files:** none — this task is a checklist of commands the user runs themselves against their own Cloudflare and Google accounts. An agent should present these steps and ask the user to run them / confirm results rather than execute cloud-account-modifying commands autonomously, since they create real billed resources and register a real OAuth client under the user's identity.

- [ ] **Step 1: Create the user's own D1 database**

```bash
wrangler d1 create psx-portfolio-sip
```

Copy the printed `database_id` into `wrangler.jsonc`'s `d1_databases[0].database_id`, replacing the placeholder.

- [ ] **Step 2: Apply migrations to the new remote database**

```bash
wrangler d1 migrations apply DB --remote
```

- [ ] **Step 3: Register a Google OAuth client**

In Google Cloud Console: create an OAuth 2.0 Client ID (type: Web application). Authorized redirect URIs: `https://<your-worker-domain>/api/auth/google/callback` and, for local testing, `http://localhost:5173/api/auth/google/callback` (confirm the actual local dev port from `npm run dev`'s output).

- [ ] **Step 4: Set `wrangler.jsonc` vars**

Fill in `ALLOWED_EMAILS` (comma-separated list of Google account emails allowed to sign in) and `GOOGLE_CLIENT_ID` (from Step 3) directly in `wrangler.jsonc`.

- [ ] **Step 5: Set secrets**

```bash
wrangler secret put GOOGLE_CLIENT_SECRET   # from Step 3
wrangler secret put SESSION_SECRET          # any random 32+ byte value, e.g. `openssl rand -base64 32`
wrangler secret put OPENAI_API_KEY          # only if AI review should work on this deployment
```

- [ ] **Step 6: Build and deploy**

```bash
npm run build
wrangler deploy --config dist/server/wrangler.json
```

- [ ] **Step 7: Verify sign-in and the allowlist**

Visit the deployed URL, click "Sign in with Google", confirm an allowlisted account signs in successfully and lands back on `/`. Then, with a second (non-allowlisted) Google account, confirm the callback redirects to `/?error=oauth_email` and no session cookie is set.

- [ ] **Step 8: Restore portfolio data**

Sign in, use the app's existing backup-import feature to restore the portfolio export saved before cutover (per the user's confirmation earlier in this project that the export is already in hand).

---

## Self-review notes

- **Spec coverage:** every "Removed"/"Added"/"Changed" item in the spec maps to a task (Tasks 3, 4, 5, 6, 7). The spec's Data section (no schema change, email becomes `userId`) is covered by Task 5's `return user.email`. Error handling (generic `?error=` redirects, case-insensitive allowlist) is in Task 4. Testing (session round-trip/tamper/expiry) is Task 1. Deployment steps are Task 9, explicitly marked manual/user-run per the "Executing actions with care" concern about creating real cloud resources and OAuth registrations.
- **Placeholder scan:** no TBD/TODO; every code step has real, complete code.
- **Type consistency:** `AuthUser = { email: string }` (Task 3) flows into `identity()` returning `user.email` (Task 5); `signSession`/`verifySession`/`serializeCookie`/`serializeExpiredCookie`/`readCookieValue` signatures are identical everywhere they're declared (Task 1) and consumed (Tasks 3, 4).
