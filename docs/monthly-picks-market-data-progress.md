# Monthly Picks and PSX data reliability: progress tracker

Updated 2 October 2026. Plan: `docs/claude-implementation-plan.md`. A stage counts as complete only when its gate passes.

## Overall: `███████░░░░░░░░░░░░░ 36%`

| Stage | Weight | Progress | Gate |
|---|---|---|---|
| 1 Contracts and regression coverage | 10% | `████████░░ 80%` | Partly met |
| 2 Ingestion and cache correctness | 20% | `█████░░░░░ 50%` | Not met |
| 3 Counts, indices, statistics | 15% | `██░░░░░░░░ 20%` | Not met |
| 4 Picks evidence and allocation | 20% | `█████████░ 90%` | Met except price-freshness and cache keys |
| 5 Durable execution, truthful progress | 15% | `████████░░ 85%` | Met locally; not run against Cloudflare |
| 6 Web/mobile integration, release | 20% | `███░░░░░░░ 30%` | Not met |

Percentages are my estimate of completed checklist items per stage. Overall = weighted sum of stages (stage 1 counted at 80%, no stage credited 100%).

## Checklist

### Stage 1
- [x] Regression tests written before fixes: `tests/picks-reliability.test.mjs` (8 of 11 failed on the old code), `tests/psx-market.test.mjs` (holiday/estimated), `tests/quote-write.test.mjs`.
- [x] Shared types for recommendations, progress, facts, health, `DataMeta`/`Freshness` in `lib/api-types.ts` and `lib/market-meta.ts`.
- [x] Runtime validators for recommendation responses: `lib/api-validate.ts` (not yet called by the clients).
- [ ] Market-summary response types and validators. Legacy `index`/`series` untouched.
- [ ] Metadata (`DataMeta`) attached to price, index, facts and history responses. The type and classifier exist; no route returns them yet.

### Stage 2
- [x] Conditional quote upsert shared by Worker and scraper (`lib/quote-write.ts`); late or older writes lose.
- [x] Fair scheduling: alphabetical 200-ticker cut removed; stalest-first under the fetch budget (test services 12 symbols with budget 3).
- [x] Staging cannot dispatch the production-writing workflow (`dispatchBlockedReason`).
- [x] Market-hours holiday handling and `estimated` labelling.
- [x] Adapters already had deadlines, bounded retries and `Retry-After`; no change needed.
- [ ] Source-time ordering for quotes. Not done: `as_of` is display text, no column added. Ordering is trading day then fetch time.
- [ ] Single homepage fetch for four indices; All-Share bulk observations; atomic snapshot generation pointer.
- [ ] Persisted per-ticker due schedule (current ordering uses `fetched_at`, which is equivalent for quotes but is not a stored queue and does not cover facts/history).
- [ ] Removal of the obsolete unauthenticated timeseries fallback (not located or verified).
- [ ] Attempt records separate from observations (failure timestamps).

### Stage 3
- [x] `pakistanMarketState` respects the holiday calendar; year boundary tested.
- [x] Session-aware freshness classifier (`lib/market-freshness.ts`, 10 tests).
- [ ] Security catalog, count definitions, advance/decline from one coherent dataset.
- [ ] KSE-30, KMI-30, All-Share ingestion and cards.
- [ ] Chart/headline session pairing; sampled index series.
- [ ] Market-summary reads still call pyPSX when the 30 s cache expires (see deviations).

### Stage 4
- [x] Tie-aware percentile ranks, no neutral value for missing metrics.
- [x] EPS zero handling, CAGR over elapsed years, TTM only from four consecutive discrete quarters, duplicate periods rejected.
- [x] Score separated from evidence completeness; confidence uses both; minimum two metrics for quant selection.
- [x] Announcement recency no longer scored.
- [x] Facts older than 7 days excluded from selection (kept in coverage with the reason).
- [x] Valid 100%-cash AI result accepted; all-invalid picks still fall back with the exact reason.
- [x] Holdings-aware sizing: 35% contribution cap, 20% concentration cap, paisa arithmetic, overweight gets zero, incomplete flagged, stored in `sizing`.
- [x] AI budget and monthly cap reserved inside one INSERT.
- [ ] Immutable full snapshot (holdings, quotes, index context) stored with the run. Only the existing facts snapshot is stored; holdings are fingerprinted in `sizing`.
- [ ] Structured evidence references for AI claims; announcements treated as untrusted text in the prompt.
- [ ] Session-aware price freshness for estimates (client estimate still uses 7 days).
- [ ] Cache reuse keyed on holdings fingerprint and data versions (reuse is still by inputs and day).
- [ ] Versioned model/pricing configuration.

### Stage 5
- [x] Engine extracted to `lib/recommendation-service.ts`, runs in either Worker.
- [x] Migration `0020`: lease token/expiry, next attempt, deadline, progress JSON, idempotency key (unique per user).
- [x] Atomic lease claim, expiry recovery, stale holders cannot write, 30-minute watchdog, retry with backoff.
- [x] Per-minute cron in `workers/quote-refresh` calls `processDueRuns`.
- [x] GET read-only behind `PICKS_BACKGROUND=true`; legacy nudging otherwise (rollout flag).
- [x] Idempotent POST, one active run per user.
- [x] Uncertain AI submissions keep their reservation and are never resubmitted.
- [x] Persisted steps and real counts: `lib/monthly-picks-progress.ts`; only a saved result reaches 100%.
- [x] Admin health: `GET /api/admin/health`.
- [ ] Facts refresh requests deduplicated across users already existed; "persist before dispatch" verified only by existing code reading.
- [ ] Watchdog for missed market ingestion (health reports lag but does not alert).
- [ ] Verified on Cloudflare (cron firing, D1 behaviour). Only a node:sqlite D1 shim was used.

### Stage 6
- [x] Web and mobile progress display from persisted fields; 5 s then 15 s polling; mobile stops when backgrounded.
- [x] Fallback reason and allocation-limit explanations shown on both clients.
- [x] pyPSX: 30 s cache, in-flight dedupe, 6 s timeout, out-of-order rejection.
- [ ] Four index cards, counts, evidence-coverage UI.
- [ ] Web polling stops on hidden tab (existing behaviour: pauses and rechecks every 3 s; unchanged).
- [ ] Minute-level market summary refresh and cached closing data off-session.
- [ ] pyPSX reconnect/cleanup for the streaming route (`app/api/market-stream`) not reviewed.
- [ ] Documentation update (README/CLAUDE.md) for the new architecture.
- [ ] Staging evidence on two sessions.

## Confirmed findings (against current code)
Confirmed and fixed: tie ranks; missing metric neutral 50; CAGR row count; zero EPS as missing; TTM summed non-consecutive quarters (the real LUCK page lists Q3 2026, Q2, Q1 and Q3 2025, so the old figure mixed years); cash-only AI rejected; confidence followed score; unconditional quote upsert; alphabetical 200 cap; stale facts selectable; allocations ignored holdings; holiday weekdays reported open; recommendations advanced only by GET polling; staging could dispatch the production workflow when a token was set.
Confirmed, not fixed: market-summary reads still reach pyPSX at cache expiry; routes return no `DataMeta`; index/count issues in stage 3.
Not verified: that pyPSX or All-Share behave as the plan describes (no network calls made).

## Justified deviations
- Quote ordering uses trading day then fetch time (no `observed_at` column).
- Quant TTM EPS is now `null` for most real pages because PSX omits Q4 from the quarterly table. This is honest but lowers the metric's availability. P/E TTM published by PSX still drives valuation.
- On an empty portfolio the 20% concentration cap limits a single pick to 20% of fresh money, tighter than the 35% contribution cap. This follows the plan's literal rule; confirm it is intended.
- Client share estimates still derive money from `allocationPct`, so figures can differ from `sizing.allocationPkr` by under one paisa-rounding step.

## Tests run (actual)
- Root: `node --test --test-isolation=none tests/*.test.mjs`: 447 pass, 0 fail.
- Mobile: `node --test --experimental-strip-types "src/**/*.test.ts"` in `mobile/`: 135 pass, 0 fail.
- `npx tsc --noEmit` in root and `mobile/`: no errors.
- `npm run build`: succeeds.
- `wrangler deploy --dry-run` for `workers/quote-refresh`: bundles.
- `npx oxlint`: repo has pre-existing errors (about 29, e.g. `components/ui/*`, `app/portfolio.tsx`); none reported in files I added or edited after fixing one a11y error. No clean baseline comparison was made.

## Release requirements and unverified gates
1. Apply `drizzle/0020_special_post.sql` locally, then staging, then production (additive columns and indexes).
2. Deploy web Worker first with `PICKS_BACKGROUND=false` (behaviour unchanged, GET still advances runs under a lease).
3. Deploy `workers/quote-refresh` (`npm run quote-refresh:deploy`) with the `OPENAI_API_KEY` secret and, for production only, `GITHUB_DISPATCH_TOKEN`. Its per-minute cron needs these.
4. Confirm cron runs: `GET /api/admin/health` as super admin shows no stuck runs; start a run and close the app.
5. Set `PICKS_BACKGROUND=true`, redeploy web Worker.
6. Release mobile update after the backend.
Rollback: set `PICKS_BACKGROUND=false`; redeploy the previous web build; migrations and saved runs stay. New columns are nullable so old code ignores them.
Unverified: everything on Cloudflare (cron firing, D1 conflicts under real concurrency), staging over two sessions, mobile on device, GitHub dispatch, OpenAI calls (fake fetch only).
