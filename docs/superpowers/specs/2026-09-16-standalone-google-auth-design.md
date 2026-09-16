# Standalone deployment with Google OAuth login

Date: 2026-09-16

## Purpose

This app currently only runs as an OpenAI Sites app: it's built with
`@openai/sites-vite-plugin`, deployed through OpenAI's own Cloudflare
pipeline (`.openai/hosting.json` supplies a placeholder D1 database ID
that Sites fills in at deploy time), and the only identity source is
ChatGPT's `oai-authenticated-user-*` request headers
(`app/chatgpt-auth.ts`). None of that infrastructure is owned by the
user — OpenAI controls the Worker, the D1 database, and the auth
mechanism.

The goal is to fully leave the OpenAI Sites platform: deploy this app
as an ordinary Cloudflare Worker in the user's own Cloudflare account,
with the user's own D1 database, and replace ChatGPT header auth with
Google OAuth sign-in restricted to an email allowlist. This is a
single/few-user private app (an investment ledger), not a multi-tenant
product — there is no requirement for a general-purpose accounts
system.

## Non-goals

- Multi-tenant user accounts, signup flows, or a `users` table.
- Supporting more than one OAuth provider (Google only).
- Any dual-mode auth branching — the ChatGPT/Sites path is deleted
  outright, not kept behind a flag.
- Migrating historical D1 data automatically. The user has an existing
  portfolio backup export (a JSON export feature already in the app,
  per `README.md`) and will re-import it manually into the new
  database after cutover.
- Changes to `db/schema.ts`, portfolio calculation logic
  (`lib/portfolio.ts`, `lib/portfolio-reports.ts`), or any UI beyond
  the sign-in entry point.

## Current state (for reference)

- `app/chatgpt-auth.ts`: `getChatGPTUser()` reads
  `oai-authenticated-user-id` / `-email` / `-full-name` headers.
  `requireChatGPTUser`, `chatGPTSignInPath`, `chatGPTSignOutPath` are
  defined but **unused** elsewhere in the app (dead code — confirmed
  via repo-wide grep).
- `lib/server.ts#identity(req, write)`: the only real call site of
  `getChatGPTUser()`. Throws `'Sign in to access your portfolio.'` if
  no user; returns `user.userId`, which is used as the row key for
  `portfolios` / `ai_reviews` in D1.
- `app/portfolio.tsx`: client component. On a 401 from `/api/portfolio`
  it renders a hardcoded `<a href="/signin-with-chatgpt?return_to=%2F">`
  link. This is the only UI-level auth touchpoint.
- `app/page.tsx`: a server component, currently just renders
  `<Dashboard />` with no props.
- `vite.config.ts`: imports `.openai/hosting.json`, calls `sites()`
  from `@openai/sites-vite-plugin`, and builds Cloudflare bindings
  (`d1_databases`, `r2_buckets`) from that hosting config for local
  dev. The `sites()` plugin's only jobs (confirmed from its README):
  copy `.openai/hosting.json` into `dist/.openai` at build time (fails
  the build if missing), and simulate a ChatGPT identity during
  `vite dev`. It does not implement the real
  `/signin-with-chatgpt` flow in production — that's done by OpenAI's
  Sites reverse proxy, which won't exist in the new deployment.
- `wrangler.jsonc` (repo root): used both for
  `npm run db:migrate:local` and as the config `@cloudflare/vite-plugin`
  picks up for `npm run build` (confirmed by inspecting
  `dist/server/wrangler.json` after a build — it embeds the exact
  content of root `wrangler.jsonc`, including the placeholder
  `database_id`).
- `db/env.d.ts`: declares `Cloudflare.Env` — `DB`, `OPENAI_API_KEY?`,
  `OPENAI_MODEL?`.

## Target architecture

One deployment: a Cloudflare Worker in the user's own account, built
and deployed with the existing `vinext build` + `wrangler deploy`
toolchain the user runs themselves (no OpenAI pipeline involved).

### Removed

- `app/chatgpt-auth.ts` (deleted entirely, including the dead
  `requireChatGPTUser` / `chatGPTSignInPath` / `chatGPTSignOutPath`
  exports).
- `@openai/sites-vite-plugin` dependency and its `sites()` call in
  `vite.config.ts`.
- `.openai/hosting.json` and the `.openai/` directory.
- The `SITE_CREATOR_PLACEHOLDER_DATABASE_ID` constant and
  hosting-config-driven binding logic in `vite.config.ts`.

### Added

**`lib/auth.ts`** — replaces the identity portion of
`app/chatgpt-auth.ts`:

- `getCurrentUser(): Promise<{ email: string } | null>` — reads and
  verifies the session cookie (see below). Returns `null` if missing,
  malformed, expired, or the signature doesn't verify.
- `signInPath(returnTo: string): string` → `/api/auth/google/login?return_to=...`
  (reuses the existing `safeRelativeReturnPath` validation logic moved
  over from `chatgpt-auth.ts`, since open-redirect protection is still
  needed here).
- `signOutPath(returnTo = '/'): string` → `/api/auth/logout?return_to=...`

**`lib/session.ts`** — stateless signed session cookie, no D1 table:

- Cookie payload: `{ email: string, exp: number }` (exp = issue time +
  30 days), base64url-encoded JSON.
- Signature: HMAC-SHA256 over the payload using `env.SESSION_SECRET`,
  computed with the Workers-native `crypto.subtle` API (no new
  dependency).
- Cookie value: `<base64url payload>.<base64url signature>`.
  `HttpOnly; Secure; SameSite=Lax; Path=/`.
- `signSession(email, secret): Promise<string>` and
  `verifySession(cookieValue, secret): Promise<string | null>`
  (returns the email on success, `null` on any failure — expired,
  tampered, wrong secret, malformed).

**`app/api/auth/google/login/route.ts`**:

- Reads `return_to` query param (validated via the same
  `safeRelativeReturnPath` helper).
- Generates a random `state` (crypto-random, base64url), stores it in
  a short-lived (5 min) `HttpOnly` cookie `oauth_state`, and 302s to
  Google's authorization endpoint
  (`https://accounts.google.com/o/oauth2/v2/auth`) with
  `client_id=env.GOOGLE_CLIENT_ID`, `redirect_uri` (this deployment's
  `/api/auth/google/callback`), `response_type=code`,
  `scope=openid email`, and `state`. The validated `return_to` is
  stored in a second short-lived (5 min) `HttpOnly` cookie
  `oauth_return_to` alongside `oauth_state`, so it survives the round
  trip without needing to be encoded into `state` itself.

**`app/api/auth/google/callback/route.ts`**:

- Verifies the `state` query param matches the `oauth_state` cookie;
  rejects (redirect to `/?error=oauth_state`) if not.
- Exchanges the `code` for tokens at Google's token endpoint
  (`https://oauth2.googleapis.com/token`) using
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- Calls Google's userinfo endpoint
  (`https://openidconnect.googleapis.com/v1/userinfo`) with the
  returned access token to get `{ email, email_verified }`. This
  avoids implementing JWT/JWKS signature verification ourselves —  a
  direct authenticated HTTPS call to Google is simpler and just as
  trustworthy for this use case.
- Rejects (redirect to `/?error=oauth_email` — no detail leaked) if
  `email_verified` is falsy or `email` is not present, case-
  insensitively, in the comma-separated `env.ALLOWED_EMAILS` list.
- On success: signs a session cookie via `lib/session.ts`, sets it,
  clears `oauth_state`, and redirects to the validated `return_to`
  (default `/`).

**`app/api/auth/logout/route.ts`**: clears the session cookie, redirects
to `return_to` (default `/`).

### Changed

- **`lib/server.ts#identity()`**: calls `getCurrentUser()` from
  `lib/auth.ts` instead of `getChatGPTUser()`. Same error message
  (`'Sign in to access your portfolio.'`) and same origin-check logic
  for writes — unchanged contract for API routes. Returns `email` as
  the `userId` (this becomes the new stable row key for
  `portfolios` / `ai_reviews`; see Data below).
- **`app/page.tsx`**: no change needed — sign-in path is fully
  client-driven from the 401 response, so no server-side prop passing
  is required now that there's only one auth mode.
- **`app/portfolio.tsx`**: the hardcoded
  `<a href="/signin-with-chatgpt?return_to=%2F">Sign in with ChatGPT →</a>`
  becomes `<a href="/api/auth/google/login?return_to=%2F" target="_top">Sign in with Google →</a>`.
- **`vite.config.ts`**: drop `sites()` and the `hostingConfig` import;
  declare the `DB` D1 binding directly for local dev (binding name
  `DB`, a local dev database name/id — no `r2` binding since `r2` was
  already `null` in the removed hosting config).
- **`wrangler.jsonc`**: real `database_id` (from
  `wrangler d1 create psx-portfolio-sip`, run once by the user), plus
  `vars: { ALLOWED_EMAILS, GOOGLE_CLIENT_ID }`. Secrets
  (`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `OPENAI_API_KEY`) are set
  separately via `wrangler secret put <NAME>` — never committed.
- **`db/env.d.ts`**: add `ALLOWED_EMAILS: string`,
  `GOOGLE_CLIENT_ID: string`, `GOOGLE_CLIENT_SECRET: string`,
  `SESSION_SECRET: string` to `Cloudflare.Env`.
- **`package.json`**: remove `@openai/sites-vite-plugin` from
  `devDependencies`.
- **`README.md` / `CLAUDE.md`**: update the auth/deployment
  description to match (no more Sites/ChatGPT references); done as
  part of implementation, not detailed further here since it's
  documentation, not behavior.

## Data

No schema change. `portfolios.user_id` (and `ai_reviews`) simply
becomes keyed by the signed-in Google email instead of the ChatGPT
`userId`. Since this is a brand-new D1 database (the old one is
OpenAI-managed and unreachable from the new deployment), there is no
existing-row migration to reconcile — the user re-imports their
existing backup export through the app's normal import UI after first
sign-in, which will write fresh rows keyed by their email.

## Error handling

- Missing/invalid/expired session cookie → `getCurrentUser()` returns
  `null` → `identity()` throws the existing `'Sign in to access your
  portfolio.'` → `failure()` maps to HTTP 401, exactly as today.
- OAuth `state` mismatch, token exchange failure, or email not on the
  allowlist → redirect to `/` with a generic `?error=` code; no
  internal detail (provider error bodies, which emails were tried,
  etc.) is ever surfaced to the client or logged in a user-visible
  place.
- `ALLOWED_EMAILS` comparison is case-insensitive and trims whitespace
  around each entry (a config typo like a trailing space shouldn't
  silently lock the owner out).

## Testing

- `tests/session.test.mjs` (new, plain `node:test` + `node:assert`,
  matching existing style): sign a payload, verify it round-trips;
  tamper with the signature/payload and confirm `verifySession`
  returns `null`; confirm an expired `exp` is rejected.
- Existing `tests/portfolio.test.mjs` etc. are untouched — they test
  calculation logic, not auth.
- Manual verification before calling this done: `npx tsc --noEmit`,
  `npm run build`, local `wrangler dev` login round-trip against a
  real (test) Google OAuth client, confirm a non-allowlisted Google
  account is rejected, confirm the existing portfolio backup import
  works end-to-end on the fresh D1 database.

## Deployment steps (user-run, not automated)

1. `wrangler d1 create psx-portfolio-sip` → note the real
   `database_id`, put it in `wrangler.jsonc`.
2. Register an OAuth client in Google Cloud Console (type: Web
   application), authorized redirect URI = the deployed
   `https://<worker-domain>/api/auth/google/callback` (and a
   `localhost` one for local dev).
3. `wrangler secret put GOOGLE_CLIENT_SECRET`,
   `wrangler secret put SESSION_SECRET` (a random 32+ byte value),
   `wrangler secret put OPENAI_API_KEY` (if AI review is wanted here).
4. Set `ALLOWED_EMAILS` and `GOOGLE_CLIENT_ID` in `wrangler.jsonc`
   `vars` (not secret — client IDs are public by design).
5. `npm run db:migrate:local` equivalent against the new remote DB
   (`wrangler d1 migrations apply DB --remote`), then
   `npm run build && wrangler deploy`.
6. Sign in, use the app's import feature to restore the existing
   backup export.
