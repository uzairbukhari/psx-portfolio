# AHL import and dividend sync — progress

Plan: `docs/ahl-import-dividend-sync-plan.md`

Last updated: 2026-10-02 (Asia/Karachi)

## Current status

**All six stages implemented and locally verified.** Nothing was committed, pushed, deployed, migrated remotely, or imported into a real portfolio. Items that need external access (GitHub workflow dispatch, the IPO scraper writing to D1, a real-account import) are listed under "Unverified" and in the release steps.

Overall accepted implementation progress: **100%** `[####################]`

| Stage | Weight | Status | Evidence |
| --- | ---: | --- | --- |
| 1. Contracts, fixtures, baseline | 10% | **Accepted** | Baseline 481/481; `tests/ahl-contracts.test.mjs` (8) |
| 2. AHL PDF parser | 20% | **Accepted** | `tests/ahl-ledger-pdf.test.mjs` (7) incl. real file: 61 trades through the production extraction path |
| 3. Reconciliation, IPO, import review | 25% | **Accepted** | `tests/ahl-reconcile.test.mjs` (14), `tests/ipo-offers.test.mjs` (5); browser import and re-import verified |
| 4. Historical refresh and eligibility | 20% | **Accepted** | `tests/refresh-requests.test.mjs` (9), eligibility cases in `tests/dividend-history.test.mjs` |
| 5. Bulk received-dividend review | 15% | **Accepted** | `tests/dividend-history.test.mjs` (15); browser approve and reload verified |
| 6. End-to-end and release handoff | 10% | **Accepted**, with the unverified items below | Full suite, tsc, build, mobile tests, browser |

## Acceptance checklist

- [x] Read repository guidance and inspect current changes; preserve unrelated work (the checkout was clean apart from the untracked `docs/claude-implementation-plan.md`, which was left untouched).
- [x] Baseline recorded: `node --test "tests/*.test.mjs"` 481 pass / 0 fail before any change.
- [x] Anonymized fixtures (`tests/helpers/ahl-ledger-fixture.mjs` builds invented PDFs: account "CC00001", "TEST CLIENT") and backward-compatible metadata.
- [x] Supplied PDF parsed through the production extraction path (`extractMarkedText`): 61 trades (52 buys, 9 sells, 24 symbols), debit 796,875.70, credit 819,420.31, balance -22,544.61, JSRR gross price 10.70.
- [x] Historical calendars and settlement conversion (see Decisions: 2025 lunar holidays are press-reported and flagged).
- [x] No duplicates across repeated or overlapping PDF and JSON imports.
- [x] Legitimate identical fills preserved; ambiguous matches need a decision.
- [x] IPO evidence lookup, labelled fallback, acquisition corrections.
- [x] Import preview and atomic revision-checked saving (a stale preview forces re-review; the PUT revision check is the backstop).
- [x] Per-company refresh status and environment-safe workflow dispatch.
- [x] Historical entitlement including sold holdings, splits, settlement and holiday transitions.
- [x] Multi-select and approve-as-received.
- [x] Unknown payment dates without invented tax or net amounts.
- [x] Existing and CDC dividends reconciled; approved entries survive reload.
- [x] Mobile and shared-contract compatibility (mobile `tsc` clean, 136 mobile tests pass, including a new unknown-payment-date test).
- [x] Automated and browser checks recorded below.
- [x] Configuration, migration, release and rollback documented below.

## Contracts (Stage 1)

Trade (all optional): `settlementDate`, `dateCertainty` (`confirmed`|`inferred`), `statementRef` (fingerprint:voucher), `netCash` (reported cash), `inferred` (`basis` ipo-offer|sale-price-fallback, `priceSource`, `dateBasis`, `forSale`, `label`), `supersededBy`. Statement trades use `source: 'ahl'` and `externalId` `ahlpdf:<12-hex account fingerprint>:<voucher>:<symbol>:<b|s><qty>:<paisa>:<occurrence>`; assumed acquisitions use `ahl:inferred:...`. Trade ids are `ahl-b-…` / `ahl-s-…` so buys sort before sells on one date.

Dividend (all optional): `paymentDateUnknown`, `receiptConfirmedAt`, `entitlement` (frozen shares, rate, book-closure end, details, announced-on, face value, rate source, certainty). `validate()` accepts a received auto dividend without `paymentDate` only when `paymentDateUnknown === true` and `receiptConfirmedAt` are both present and `paymentDate` is absent; the legacy invalid shape (received, no date, no flag) is still rejected. `confirmDividendReceipt` clears the flag when a real date is supplied. `taxSummary().receivedUnknownPaymentDate` and `portfolioReport().realized.receivedUnknownPaymentDate` expose the bucket; the Reports tab shows it separately.

Tolerances: cash is compared in whole paisa (1 paisa on balances and totals); the unit price snaps to 0.01 only when `|price × shares − gross| ≤ 0.0055`; reported-vs-recorded net cash per fill ≤ 0.02 when matching existing trades; component fees vs reconstructed fees ≤ 0.0105.

## Work log

| Date | Stage | Work completed | Evidence |
| --- | --- | --- | --- |
| 2026-10-02 | 1 | Contract fields, validation, report bucket, `saleShortfalls`, exported dividend helpers | `ahl-contracts` 8/8 |
| 2026-10-02 | 2 | `lib/ahl-ledger-pdf.ts`; `extractMarkedText` shared by `app/research-pdf.ts` and tests; historical calendar in `lib/psx-calendar.ts` | `ahl-ledger-pdf` 7/7 |
| 2026-10-02 | 3 | `lib/ahl-reconcile.ts`, `lib/ipo-offers.ts`, `lib/ipo-evidence.ts`, `scripts/psx-ipo-scrape.mjs`, `psx-ipo.yml`, `app/ahl-import-dialog.tsx`, Settings wiring | `ahl-reconcile` 14/14, `ipo-offers` 5/5; a read-only scraper dry run found the JSRR offer price 10.7 |
| 2026-10-02 | 4 | Migration `0023_special_big_bertha.sql` (`refresh_requests`, `ipo_offers`), `lib/workflow-requests.ts`, `lib/refresh-api.ts`, `/api/dividends/refresh`, `/api/ipo-offers`, payouts workflow `tickers` input and per-run concurrency, `scripts/refresh-state.mjs` | `refresh-requests` 9/9 |
| 2026-10-02 | 5 | `lib/dividend-history.ts`, `app/dividend-sync-view.tsx`, Reports note | `dividend-history` 15/15 |
| 2026-10-02 | 6 | README and CLAUDE.md, mobile test, full verification | below |

## Verification log

| Check | Result | Evidence |
| --- | --- | --- |
| `node --test "tests/*.test.mjs"` | **Pass**: 540 tests, 539 pass, 0 fail, 1 skipped (the real-statement test, skipped unless `AHL_LOCAL_PDF` is set) | After the final edits |
| Real statement, `AHL_LOCAL_PDF` set | **Pass** 7/7, 0 skipped | 61 trades; the plan imports 61, one assumed JSRR acquisition (IPO offer 10.70, listing date 2026-05-18, 1,500 shares), re-upload is idempotent, no date needs confirmation |
| `npx tsc --noEmit` (root) | **Pass** | |
| Mobile `npx tsc --noEmit` and `node --test --experimental-strip-types 'src/**/*.test.ts'` | **Pass**, 136 tests | |
| `npm run lint` | 29 errors, **none in files changed or added by this work** (they are in `components/ui/*`, `hooks/*`, `tests/quote-cache.test.mjs`, and untouched lines of `app/portfolio.tsx` and `lib/portfolio.ts`) | New files lint clean |
| `npm run build` | **Pass** | |
| `git diff --check` | No whitespace errors (only LF/CRLF notices) | |
| Browser, production build via `npm run start`, local test user `ahl-test@localhost`, synthetic PDF | **Pass**: preview of 10 trades with 4 excluded categories; the unconfirmed-date row blocked the import until confirmed; the import saved 11 trades (10 imported plus one assumed IPOX acquisition, labelled fallback) at revision 2; re-upload showed "0 to import / 10 already in ledger" with the button disabled; a malformed PDF produced an error toast and changed nothing; Sync dividends showed partial, failed and queued fetch states, the "not configured" dispatch state, face-value and corporate-action confirmations, select-all-resolved (2 rows, Rs 212), approval with confirmation, stored entries with `paymentDateUnknown`, and a reload kept them (0 voided); the 400px layout had no horizontal overflow | Not exercised in a browser: the ambiguous-match dropdown, the stale-preview banner, a 409 conflict (unit-tested) |
| Real statement in the browser | **Not run**: the browser tool refused a path outside its workspace roots, so the real file was verified through the same extraction, parse and plan code in Node | |
| GitHub dispatch, `psx-ipo.yml` and `psx-payouts.yml` runs, scraper D1 writes | **Not run** (would write production). Dispatch is covered by unit tests with a fake `fetch`; `psx-ipo-scrape.mjs --dry-run` reached PSX read-only and found JSRR | |

During browser testing `.dev.vars` (which holds the dispatch token) was swapped for a sanitized copy so that no real workflow could be dispatched, then restored byte-identical (checked by hash). Local D1 state under `.wrangler/` and `dist/` is git-ignored.

## Decisions and deviations

- **Dev server limitation**: pdf.js text extraction fails in `npm run dev` with "window is not defined" (the Vite worker problem described in `app/research-pdf.ts`); PDF import was verified on the production build.
- **Calendar sources**: psx.com.pk publishes only the current year (2026, treated as official). 2025 lunar holidays (Juma-tul-Wida 28 Mar, Eid-ul-Fitr 30 Mar–1 Apr, Eid-ul-Azha 7–9 Jun, Ashura 5–6 Jul, Eid Milad 5 Sep) come from press reports of PSX notices and are tiered `reported`: a date recovery or dividend cutoff that crosses one of them is `inferred` / "holidays unconfirmed" and must be confirmed. Fixed national holidays are always certain. Before 2024-11-01 no lunar information exists (flagged). No official 2024 or 2025 PSX list could be fetched, so those years are **not** claimed verified; replace `REPORTED_LUNAR_HOLIDAYS` when official lists are found.
- **Settlement**: T+1 from 9 Feb 2026 as given in the plan; the NCCPL page returned 403 to the fetch tool, so the date was taken from the plan and not re-read.
- **IPO evidence**: JSRR is curated by hand from the final offer document (fixed price PKR 10.70, subscription 5–6 May 2026) and PSX notice PSX/N-608 (trading from 18 May 2026). Those documents publish no allotment date, so the listing date is used and labelled inferred. The notice's opening price (10.70) was not used as proof; the offer document was. The scraper only finds offers PSX still publishes on its pride pages; anything else reports `not-found` with the reason and the user-requested fallback applies. Scraped evidence is `extracted` and needs the user's acceptance.
- **Statement fingerprint**: a truncated SHA-256 of the account code (low entropy, so not secret against brute force; it carries no name, bank detail or account number).
- **Shared tables**: `refresh_requests` and `ipo_offers` hold no per-user data and are listed in `SHARED_TABLES`. `lib/ipo-offers.ts` was added to the mobile-portable list in `tests/shared-lib.test.mjs`.
- **Unchanged**: forward automatic tracking (`pendingAutoDividends`, `startDividendTracking`, `planAutoDividendUpdate`). Approved historical entries use the same announcement identity, so they are skipped and never voided.

## Remaining limitations

- Announcement history depth is whatever PSX's payouts table returns; the first announcement date is shown as coverage and earlier payouts may be absent.
- Corporate-action detection is a price-jump heuristic (a factor of two or more between consecutive trades with no recorded split); bonus and right issues are not booked.
- Matching uses cash tolerances; two genuinely different trades with the same symbol, side and quantity and near cash on nearby dates are shown as ambiguous rather than guessed.
- The IPO scraper cannot discover offers that are no longer on PSX's pride pages; add verified entries to `CURATED_IPO_OFFERS` instead.

## Release instructions (in this order)

1. Review the diff and run `node --test "tests/*.test.mjs"`, `npx tsc --noEmit`, `npm run build`.
2. **Migration**: apply `drizzle/0023_special_big_bertha.sql` (adds `refresh_requests` and `ipo_offers`; additive only). `deploy.yml` already runs `wrangler d1 migrations apply DB --remote` on push to `main`; for staging run `npm run db:migrate:staging`.
3. **Configuration**: no new Worker variables or secrets. Production dispatch uses the existing `GITHUB_DISPATCH_TOKEN` (Actions read/write) and `GITHUB_REPO`; the token must be allowed to dispatch `psx-payouts.yml` and the new `psx-ipo.yml`. Staging keeps no token and `APP_ENV=staging` refuses dispatch.
4. **Workflows**: merge `.github/workflows/psx-ipo.yml` and the changed `psx-payouts.yml` (new optional `tickers` input; on-demand runs have their own concurrency group). `psx-ipo.yml` runs `npm ci --ignore-scripts` and uses the `prod` environment secrets the other scrapers already use.
5. Deploy (merge to `main`). Signed in, check Settings: AHL trades accepts a PDF, Sync dividends loads, and "Refresh PSX announcements" goes queued, running, completed (confirm in the Actions run).
6. First real import: upload the statement, review the preview, confirm any flagged dates, optionally use "Look up official IPO price", import. Then run Sync dividends: refresh, review, approve.

## Rollback

- Code: revert the deploy. The new fields are optional and ignored by older code, but **an older build rejects a ledger that contains a received auto dividend with no `paymentDate`** (`validate`). Before rolling back after approving dividends, correct those entries (Activity, correct the dividend, enter a payment date) or keep the new build. Do not delete ledger data to roll back.
- Database: leave `refresh_requests` and `ipo_offers` in place (unused tables are harmless). Imported statement trades and approved dividends are ordinary ledger entries that can be voided from Activity (audit kept).
- Workflows: disable `psx-ipo.yml` in the Actions UI; revert the `tickers` input on `psx-payouts.yml` if needed (scheduled behaviour is unchanged).

## Resume instructions

Nothing is blocking. Optional follow-ups: replace `REPORTED_LUNAR_HOLIDAYS` with official 2024/2025 PSX lists; run the real statement through the browser on a staging account; trigger `psx-ipo.yml` once against staging to confirm D1 writes.

## Final handoff

- Implemented behavior: AHL Client Ledger PDF import with preview, reconciliation, assumed-acquisition policy and audit trail; historical dividend review with approve-as-received; per-company refresh status; IPO evidence lookup.
- Changed subsystems: `lib/portfolio.ts` (contracts, validation, reports), `lib/psx-calendar.ts`, `lib/pdf-layout.mjs`, `app/research-pdf.ts`, Settings and dashboard wiring, Reports note, `db/schema.ts` and migration 0023, two API routes, payouts workflow and scraper, new IPO workflow and scraper, README and CLAUDE.md.
- Passed checks: see the verification log.
- Failed or unverified: real-statement browser upload (tool path restriction); live workflow dispatch and scraper D1 writes; ambiguous-match and stale-preview UI in a browser. Lint has 29 errors in untouched code.
- Required migrations/configuration: migration 0023; no new variables.
- Release order and rollback: above.
