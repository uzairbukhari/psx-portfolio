# PSX company directory & dashboard: progress

Branch `claude/project-thread-t4dk16` (local commits; nothing pushed, nothing deployed, no production data written).

## Stage status

| # | Stage | Status | Commit |
|---|-------|--------|--------|
| 1 | Shared company master and bulk ingestion | Done (live PSX unverified) | `44d8ff6` |
| 2 | Shared company resolver and web integration | Done | `b9358d6`, `c2b5c4b` |
| 3 | Verified face values and bulk dividend handling | Done (live PDF extraction unverified) | `ae97fe6`, `a805af7` |
| 4 | KSE-100-only web Market Pulse | Done | `4653114` |
| 5 | Reliable manual quote refresh and clean messaging | Done (end-to-end with GitHub dispatch unverified) | `4374aeb` |

**Stage 4 overlap.** The coordinator note said another thread was doing Stage 4 on `feat/monthly-picks-reliability`. That branch is already merged into this branch's base (PR #41) and its merge did not include the Market Pulse change, so it was done here: the four-index strip and its CSS were removed from `app/psx-market-pulse.tsx` / `app/globals.css`, and the KSE-100 card now shows its own freshness. If any other open branch edits `app/psx-market-pulse.tsx`, resolve in favour of one KSE-100 card with no other index strip.

## What was built

1. **Directory.** `security_catalog` extended (sector, per-field source, status, fingerprint, face value); `scripts/psx-directory-scrape.mjs` + `psx-directory.yml` (daily, plus dispatch with `mode`, `tickers`, `dry_run`); source ranking never lets an empty value erase a good one and never deletes rows. Migration `0024_company_directory.sql`.
2. **Resolver.** `/api/companies` (GET read-only, POST queues a lookup, 30/hour); `createCompanies` intent on `PUT /api/portfolio` is strict (422 for unresolved symbols), other saves are tolerant and repair placeholders in the background. Add Company and the trade dialog show read-only name and sector and disable Save until resolved. AHL import preview shows per-company details status.
3. **Face values.** `security_face_values` (dated, sourced evidence; conflicts marked), `/api/face-values`, `psx-face-values.yml` (weekly + dispatch). Precedence: review choice, account value, verified evidence, unresolved. **No silent Rs 10 default**: auto dividends and notifications skip the amount until a face value is known; the dividend review offers an explicit "use Rs 10 for unresolved" action that marks the assumption.
4. **Market Pulse.** See above.
5. **Quote refresh.** `POST /api/quotes` serves cached prices at once and queues stale tickers as `quotes` rows in `refresh_requests` (atomic claim: concurrent users cause one dispatch). The response keeps `quotes/errors/reasons/stale/meta` and adds `job` (`fresh|queued|running|completed|partial|failed|unavailable`, per-ticker verified outcomes). `GET /api/quotes?tickers=&since=` is read-only status. `scripts/psx-quote-scrape.mjs` snapshots open requests, scrapes held + requested tickers, verifies each by read-back of `fetched_at` (`updated | already_current | fallback_used | failed`), and completes only the requests it snapshotted (a request queued mid-run stays open); a whole-run failure fails the snapshot with a generic note. Cloudflare no longer fetches PSX for quotes: `/api/quotes`, the market-summary shortlist and the `workers/quote-refresh` cron (now only queues stale held tickers) never call PSX for prices. The web client polls (5 s, 21 min cap), resumes after reload, and shows exactly five messages. Pure logic in `lib/quote-jobs.ts`, `lib/quote-scrape-run.ts`, `lib/quote-refresh-client.ts`.

## Validation results (this session)

- `npx tsc --noEmit`: clean.
- `node --test 'tests/*.test.mjs'`: 591 tests, 590 pass, 0 fail, 1 skipped (real-statement test needs `AHL_LOCAL_PDF`). New: `company-directory`, `company-resolver`, `face-values`, `quote-jobs` tests and updated route/dividend/notification tests.
- `npm run build`: succeeds.
- Local dev (`DEV_AUTH_EMAIL`, migrations applied locally): `POST /api/quotes` with no dispatch config returns `job.state: "unavailable"` with the generic message; `GET /api/quotes` returns `idle`; invalid symbols return 400.
- `npm run lint`: **fails on a pre-existing baseline** (`components/ui/*`, `FormEvent` deprecations, effect set-state rules, etc.). Findings introduced by this work were fixed; none of the remaining ones are in files added here, except the repo-wide `role="status"` and effect set-state patterns in `app/portfolio.tsx` / `app/use-company-lookup.ts`, which match existing code.

## Not verified (blockers)

- Mobile: `npm ci && npm run typecheck && npm test` in `mobile/` pass (typecheck and 136 tests). The first PR run caught shared `lib/` modules pulling in Workers types; fixed by moving the quote job types to the import-free `lib/quote-job-types.ts` and a structural DB type in `lib/face-values.ts`. Only `mobile/src/data/auto-dividends.ts` and its test fixture changed; no screens.
- Live PSX scraping (directory, face-value evidence, quotes) and PDF extraction: PSX is not reachable from this environment and the test fixtures are synthetic, not live captures. Run the workflows with `dry_run` on a real runner first.
- GitHub dispatch end to end (queued → running → completed in the browser) needs `GITHUB_DISPATCH_TOKEN` / `GITHUB_REPO` on the Worker; not available here. Staging never dispatches by design (`unavailable`).
- Browser walkthrough (Add Company, import preview, dividend review, polling UI) was not performed: only API-level local checks. PDF import must be checked on `npm run build` + `npm run start`.
- Directory coverage numbers cannot be produced without live data; `coverageReport` in `lib/company-directory.ts` prints them from the bootstrap run.

## Behaviour changes to know about

- Percentage payouts for a company with no face value no longer auto-book at Rs 10; they wait for evidence, an account value, or the explicit assumption.
- Manual "Refresh prices" no longer returns fresh prices in the same response; it returns cached prices plus a job. Mobile calls the same endpoint and still gets `quotes`.

## Migration and configuration

- Apply `drizzle/0024_company_directory.sql` (additive; new columns have defaults) before deploying: `npm run db:migrate` equivalent for production D1.
- Workflows to enable: `psx-directory.yml`, `psx-face-values.yml`. Run `psx-directory.yml` once with `mode=bootstrap` after migrating (staging: the seed workflow now does this).
- Worker needs `GITHUB_DISPATCH_TOKEN` + `GITHUB_REPO` (already used by Monthly Picks) for on-demand lookups and refreshes; the PAT needs Actions write on `psx-directory.yml`, `psx-face-values.yml`, `psx-quotes.yml`.
- Redeploy the `workers/quote-refresh` Worker (`npm run quote-refresh:deploy`): its cron now queues instead of fetching.

## Release and rollback

1. Tag `main` (e.g. `pre-company-directory`), merge, deploy to staging first and check the Add Company, dividend review and Refresh prices flows (staging shows `unavailable` for refresh by design).
2. Production: migrate, deploy, run the directory bootstrap, then `psx-face-values.yml` once.
3. Rollback: redeploy the tag. Migration 0024 is additive and can stay; old code ignores the new columns and tables.
