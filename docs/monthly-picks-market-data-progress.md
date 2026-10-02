# Monthly Picks and PSX data reliability: progress tracker

Updated 2 October 2026. Plan: `docs/claude-implementation-plan.md`. A stage counts as complete only when its gate passes. Nothing here has run on Cloudflare production; staging results are pending (checklist in the PR).

## Overall: `█████████████████░░░ 86%`

| Stage | Weight | Progress | Gate |
|---|---|---|---|
| 1 Contracts and regression coverage | 10% | `█████████░ 92%` | Met locally |
| 2 Ingestion and cache correctness | 20% | `█████████░ 88%` | Met locally; not run against PSX/D1 under load |
| 3 Counts, indices, statistics | 15% | `█████████░ 90%` | Met locally |
| 4 Picks evidence and allocation | 20% | `██████████ 97%` | Met locally |
| 5 Durable execution, truthful progress | 15% | `█████████░ 90%` | Met on a SQLite D1 shim; Cloudflare cron unverified |
| 6 Web/mobile integration, release | 20% | `███████░░░ 72%` | Not met: no staging evidence, no device test |

Estimates are completed checklist items per stage; overall is the weighted sum. A stage is not credited 100% while its release gate (staging) is open.

## What is implemented

**Stage 1**: shared types (`lib/api-types.ts`: recommendations, progress, facts, health, indices, breadth, `DataMeta`); runtime validators and poll schedule (`lib/api-validate.ts`); regression tests written before fixes. Legacy `index`/`series` kept.

**Stage 2**
- Conditional quote upsert shared by Worker and scraper, ordered by trading day, source time (`observed_at`, migration 0021), then fetch time; an unknown source time never replaces a known one.
- Refresh attempts and failures stored apart from observations (`refresh_state`); stalest-first, then least-recently-attempted, scheduling replaces the alphabetical cap.
- One homepage fetch yields four indices, merged per index (partial failure and older observations keep stored value and timestamps).
- Worker POST on `/api/market-summary` fetches only the KSE-100 headline (dead `/timeseries/int` and `/market-watch` calls removed), writes with compare-and-set so it cannot overwrite a newer scraper snapshot, and a forced refresh is limited to once a minute per account. The single-row `market_summary_refreshes` upsert is the atomic current snapshot: quotes, indices, series and breadth are written in one payload.
- Staging cannot dispatch the production-writing workflow.
- Adapters already had deadlines, bounded retries and `Retry-After`; unchanged.

**Stage 3**: holiday-aware, year-aware market state (`estimated` only for unpublished years); session-aware freshness classifier; four index cards with `DataMeta` and sampled series (web); breadth counts from one All-Share table with excluded rows reported (web and mobile); `security_catalog` (migration 0022) names placeholder companies only; count definitions in `lib/portfolio-counts.ts` shown on both clients.

**Stage 4**: metric fixes (ties, missing, zero EPS, CAGR, TTM, duplicates); score separated from evidence completeness; confidence uses both; stale facts excluded; cash-only AI accepted; holdings-aware sizing (35% / 20%, paisa, overweight gets zero, incomplete flagged); structured evidence references resolved from the snapshot (a pick citing nothing the snapshot holds is rejected); announcement text flattened and marked untrusted in the prompt; frozen inputs (holdings, KSE-100 context, policy versions) in the snapshot; `versions` on results; reuse requires a matching holdings fingerprint; share estimates need a latest-completed-session price; atomic AI budget and monthly-cap reservation.

**Stage 5**: lease-guarded engine in `lib/recommendation-service.ts`; every-minute cron in `workers/quote-refresh`; idempotent start; one active run per user; 30-minute watchdog; retry with backoff; uncertain AI submissions never resent; persisted progress; `GET /api/admin/health` with stuck-run, quote-lag (during a session), unsettled-scrape and missing-cron warnings; `PICKS_BACKGROUND` flag for rollout and rollback.

**Stage 6**: web and mobile progress from persisted fields, 5 s then 15 s polling, mobile stops when backgrounded; fallback reason, limit explanations and cited evidence on both clients; web market pulse refreshes once a minute only while visible and in session; pyPSX 30 s cache with dedupe and timeout; stream gate (out-of-order rejection, idle and max-age close, connect timeout, `timeKnown` flag) and bounded web reconnects; README and CLAUDE.md updated; users can delete their own holdings data.

## Still open
- Staging evidence over two market sessions; real Cloudflare cron/D1 behaviour; GitHub dispatch; OpenAI calls (only a fake client was used); mobile on a device.
- pyPSX: a read after the 30 s cache expires still makes one provider call per symbol (owner only), so ordinary reads are not strictly zero external calls.
- Mobile index rows have no sparkline (web does).
- Client validators (`parseRecommendationRun`) exist but the clients do not call them yet.
- Facts and history refresh are separate workflows but have no stored due-queue (only quotes use `refresh_state`).
- Quote ordering falls back to fetch time when PSX gives no time of day.
- Admin health has an API but no screen.

## Confirmed findings (against current code)
Fixed: tie ranks; missing metric as neutral 50; CAGR row count; zero EPS as missing; TTM summed non-consecutive quarters (the live LUCK page lists Q3 2026, Q2, Q1, Q3 2025); cash-only AI rejected; confidence followed score; unconditional quote upsert; alphabetical 200 cap; stale facts selectable; allocations ignored holdings; holiday weekdays reported open; runs advanced only by GET polling; staging could dispatch the production workflow; market-summary POST called dead PSX endpoints and could overwrite a newer snapshot; forced market refresh was unlimited; share estimates accepted prices up to 7 days old; web EventSource reconnected forever; stream accepted out-of-order ticks.
Not verified: pyPSX behaviour (no network calls made to it).

## Justified deviations
- Quant TTM EPS is `null` for most real pages (PSX omits Q4 from the quarterly table). P/E (TTM) published by PSX still drives valuation.
- On an empty portfolio the 20% concentration cap limits one pick to 20% of fresh money, tighter than the 35% contribution cap (the plan literal rule).
- Untraded stocks in the All-Share table show price = last close and change 0; they count as unchanged.
- Client share estimates derive money from `allocationPct`, so they can differ from `sizing.allocationPkr` by under one rounding step.
- Older saved runs have no `sizing` or holdings fingerprint, so they are re-run once rather than reused.

## Tests run (actual)
- Root: `node --test --test-isolation=none tests/*.test.mjs`: 480 pass, 0 fail.
- Mobile: `node --test --experimental-strip-types "src/**/*.test.ts"`: 135 pass, 0 fail.
- `npx tsc --noEmit` (root and `mobile/`): no errors.
- `npm run build`: succeeds. `wrangler deploy --dry-run` for `workers/quote-refresh`: bundles.
- `npx oxlint`: the repo has pre-existing errors in files not touched here; none reported in files added or edited (checked per file). No clean baseline comparison.
- Parsers checked against the live PSX homepage and All-Share page (saved as fixtures `psx-home-all-indices.html`, `psx-allshr-full.html`): four indices parse; 558 All-Share rows.

## Release requirements
Migrations `0020`, `0021`, `0022` (additive). Order: migrate; deploy web Worker (`PICKS_BACKGROUND=false`); deploy `workers/quote-refresh` (`npm run quote-refresh:deploy`; needs the `OPENAI_API_KEY` secret and, on production, `GITHUB_DISPATCH_TOKEN`); confirm `/api/admin/health` shows no stuck runs and a run finishes with the app closed; set `PICKS_BACKGROUND=true`; ship mobile last. Rollback: `PICKS_BACKGROUND=false` and redeploy the previous web build; migrations stay (nullable columns and new tables that old code ignores).
