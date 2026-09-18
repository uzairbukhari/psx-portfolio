# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multi-user PSX (Pakistan Stock Exchange) portfolio ledger and monthly SIP (systematic investment plan) planner, built with Next.js App Router code executed by **vinext** (a Next.js-compatible runtime built on Vite + React Server Components), deployed as a **Cloudflare Worker** in the owner's own Cloudflare account, with a **D1** (SQLite) database via Drizzle ORM. Auth is Google OAuth sign-in (any verified Google account by default; `ALLOWED_EMAILS` can optionally restrict it to a list again), not a custom accounts system — every user's data is isolated by their email as the primary key.

Full product/domain rules (cost-basis accounting, SIP allocation limits, AI review scope, calculation boundaries) are documented in `README.md` — read it before changing any portfolio math, allocation logic, or AI review behavior. Do not duplicate that reasoning here.

## Commands

- `npm run dev` — start the vinext/Vite dev server (Cloudflare Worker emulation via `@cloudflare/vite-plugin` + Miniflare).
- `npm run db:migrate:local` — apply D1 migrations locally (`--local --persist-to .wrangler/state`). Run once before first local `dev`.
- `npm run db:generate` — generate a new Drizzle migration from `db/schema.ts` changes (migrations are append-only; do not edit past migration files).
- `node --test tests/portfolio.test.mjs` — run a single test file directly (all `tests/*.test.mjs` are plain `node:test` files, no test runner config needed). `node --test 'tests/*.test.mjs'` runs the whole suite — a bare `node --test tests/` (no glob) fails with `MODULE_NOT_FOUND` on this project's Node version.
- `npx tsc --noEmit` — type check.
- `npm run build` — production build to a Cloudflare Worker (`dist/`).
- `npm run start` — run the built Worker with `wrangler dev`.
- `npm run lint` / `npm run format` — oxlint / oxfmt.
- `npm run quote-refresh:dev` — run the separate PSX-refresh Worker locally (`workers/quote-refresh/`), with `--test-scheduled` so its cron handler can be triggered manually via `/__scheduled`.
- `npm run quote-refresh:deploy` — deploy the PSX-refresh Worker (its own Cron Trigger schedule, same D1 database).

## Architecture

**Routing/runtime**: `next.config.ts` exists but the app runs under `vinext`, not `next`. `app/layout.tsx` + `app/page.tsx` follow Next.js App Router conventions and Next APIs work as usual (`next/headers`, `next/navigation`, `next/font/google`). `app/page.tsx` currently mounts a single client component (`Dashboard` from `app/portfolio.tsx`) with in-app tab state — there is only one real route today (`/`); everything else (Holdings/Reports/SIP/History/Research desk/AI review) is a client-side `Tabs` value, not a URL. Auth-related paths (`/api/auth/google/login`, `/api/auth/google/callback`, `/api/auth/logout`) are reserved by `lib/auth.ts` — don't repurpose these path names for app routes.

**Auth**: `lib/auth.ts#getCurrentUser()` verifies a stateless, HMAC-signed session cookie (`lib/session.ts`) set by the Google OAuth flow (`app/api/auth/google/{login,callback}/route.ts`), optionally checking the signed-in email against `ALLOWED_EMAILS` (empty = open to any verified Google account). `lib/server.ts#identity()` wraps this for API routes and also enforces same-origin on writes.

**Data layer**: `db/schema.ts` defines D1 tables via Drizzle (`portfolios`, `ai_reviews`, `research_jobs`, `research_events`, `research_helpers`, `quote_refreshes`). `db/index.ts` wires up the Drizzle client; `lib/server.ts#db()` fetches the D1 binding from `cloudflare:workers` `env.DB`. Portfolio state is stored as a single JSON `payload` per user with a `revision` counter used for optimistic-concurrency (stale-write rejection) — see `lib/portfolio.ts` for the shape and calculation logic, and `lib/portfolio-reports.ts` for report generation.

**API routes** (`app/api/**/route.ts`): `portfolio` (load/save ledger), `quotes` (PSX price refresh), `review` (low-cost `gpt-5-nano` AI review, cached in `ai_reviews` by user+revision+month), `research/*` (background research jobs, pairing, synthesis, and a separate `research/helper` token-authenticated surface for the standalone `research-helper/` CLI tool).

**Main UI** (`app/portfolio.tsx`, ~1600 lines): holds nearly all dashboard state via `useState` (portfolio data, active tab, trade/edit dialogs, quote entry, AI review state) and renders a shadcn `Tabs` (`components/ui/tabs`) with six panels: Holdings, Reports, Monthly SIP, Purchase log, Research desk, AI review. `app/research-desk.tsx` and `app/dossier-experience.tsx` / `app/original-dossier.tsx` implement the research/dossier sub-experience embedded in the "Research desk" tab. `app/portfolio-reports.tsx` renders the Reports tab.

**research-helper/**: a separate standalone Node CLI (`research-helper/index.mjs`, `install.sh`) that talks to `app/api/research/helper/*` using a revocable token (`research_helpers` table) — not part of the Vite/React build.

**workers/quote-refresh/**: a second, independent Cloudflare Worker (own `wrangler.jsonc`, own Cron Trigger schedule at 07:00/11:00 UTC Mon–Fri = 12:00/16:00 PKT) that fetches PSX quotes for every ticker held across all users' portfolios and upserts them into the shared `quote_refreshes` table. It is separate from the main Worker because `vinext`'s generated entry only exports a `fetch` handler, not `scheduled`. `app/api/portfolio/route.ts` GET merges `quote_refreshes` into each user's response (skipping any ticker the user has manually verified), so the cron never writes to `portfolios` or touches its `revision` column.

**Testing**: no test framework/config — `tests/*.test.mjs` use Node's built-in `node:test` + `node:assert`, run individually or via `node --test 'tests/*.test.mjs'`. Tests cover calculation logic (`lib/portfolio.ts`, `lib/portfolio-reports.ts`), research policy/evidence logic, and session cookie signing/verification (`lib/session.ts`), not UI.

## Conventions

- Path alias `@/*` maps to the project root (see `tsconfig.json`) — e.g. `@/lib/portfolio`, `@/components/ui/tabs`.
- oxlint runs with `typeAware`/`typeCheck` on and treats the `correctness` category as errors; `no-explicit-any`, `no-deprecated`, and `react/rules-of-hooks` are enforced.
- `.env.local` is git-ignored; `OPENAI_API_KEY`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` are server-only secrets (never exposed client-side or committed) — set them with `wrangler secret put <NAME>` for the deployed Worker.
