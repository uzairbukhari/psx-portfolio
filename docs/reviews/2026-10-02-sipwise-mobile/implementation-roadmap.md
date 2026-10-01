# Implementation roadmap

Future work only; nothing here has been implemented. Phases are ordered by trust first, then core journeys, then the visual redesign, then new capability. Effort is relative (S ≈ a day, M ≈ a few days, L ≈ a week or more for one engineer). "OTA" means it can ship with `npm run update:staging` on the existing Android build; "Build" means it needs a new native build (the free EAS tier allows 15 Android builds a month, so batch these).

## Phase 1 · Correctness, security and trust

Ships independently, mostly OTA. Start here.

| Task | Findings | Subsystems | Effort | Ship | Acceptance check |
|---|---|---|---|---|---|
| 1.1 Shared `portfolioSummary()` in `lib/` (value of priced holdings, cost only when complete, unrealised only when complete, `incomplete` reasons, oldest quote date); use it on web and mobile; relabel hero ("Unrealised gain on current holdings", "Cost of current holdings"); drop "all time"/"Return" | FIN-001, FIN-002, FIN-007 | `lib/`, `mobile/src/data/derive.ts`, `index.tsx`, `app/portfolio.tsx` | M | OTA + web deploy | Harness F1, F4, F5 give identical summaries on both; snapshot of labels |
| 1.2 Reports: label unrealised; add total return from `grandTotalReturn` with method note | FIN-006 | `mobile/app/reports.tsx` | S | OTA | F1/F2 values shown with labels |
| 1.3 Clear all local state on any sign-out: `queryClient.clear()`, cache file, push preference, in `clearLocal`; user-scope every query key | SEC-002, SEC-003 | `AuthProvider.tsx`, `_layout.tsx`, `account.tsx`, `picks.tsx`, `MarketPulse.tsx`, `company/[ticker].tsx` | S | OTA | Unit test for `clearLocal` side effects; manual: account switch shows no prior data |
| 1.4 Return 503 (not 401) when the session lookup fails; client keeps token on 5xx | REL-001 | `lib/mobile-sessions.ts`, `lib/auth.ts`, routes' `identity()` | S | Web deploy | New test: lookup throws → 503; `tests/mobile-auth.test.mjs` still green |
| 1.5 Queue server sign-out when offline; retry on launch; show pending state | SEC-004 | `AuthProvider.tsx`, `push.ts` | S | OTA | Airplane-mode sign-out then reconnect revokes the session |
| 1.6 SIP budget draft keyed by month; Save label names the month | REL-002 | `sip.tsx` | S | OTA | Type → switch month → Save does not touch the other month |
| 1.7 Price refresh includes target and shortlist companies; refresh action on SIP | REL-003 | `usePortfolio.ts`, `sip.tsx` | S | OTA | A target-only company gets a quote from the phone |
| 1.8 Edit route refuses read-only entries | SEC-006 | `transaction.tsx` | S | OTA | Deep link to an imported id shows "imported entries can't be edited" |
| 1.9 Lock: hide content from accessibility while locked; cover on background | SEC-001 | `BiometricLock.tsx` (+ native flag later) | S (JS) / Build (FLAG_SECURE) | OTA, then Build | TalkBack reaches only Unlock; recents shows cover |
| 1.10 Clear last notification response after handling | REL-004 | `PushBridge.tsx` | S | OTA | Two cold starts after one tap open the company once |
| 1.11 Fail config for production without API URL/client id; decide on `google-services.json` (remove or document) and confirm Firebase key restriction | REL-005, SEC-005 | `app.config.ts`, `mobile/` | S | Next build | `APP_VARIANT=production` without env fails `expo config` |
| 1.12 Monthly Picks: send `rerun` only on explicit "fresh research"; show "Not set" for missing budgets | FIN-004, FIN-005 | `picks.tsx`, `sip.tsx`, web picks setup | S | OTA + web | Same inputs reuse the run (no new `ai_usage` row) |

Dependencies: 1.1 before 1.2 and before Phase 3 Today/Portfolio screens. 1.4 is server-only and independent.

## Phase 2 · Core journey usability and parity

| Task | Findings | Effort | Ship | Acceptance check |
|---|---|---|---|---|
| 2.1 Target-weight editor (mobile and web) with running total, 20% cap note, screening date; SIP empty state becomes guided setup | FIN-003 | M | OTA + web | New account goes from no targets to suggested buys on the phone |
| 2.2 Record PSX auto dividends and announcement alerts without the web: preferably server-side in the payout scraper (uses `pendingAutoDividends`, revisioned update), else port the web's 409-retry loop into a shared client helper | PAR-002 | M | Web/scraper (+ OTA) | With only the phone in use, a new announcement shows as an expected dividend and an alert |
| 2.3 Mark received on company and from alert (`confirmDividendReceipt`) | PAR-003 | S | OTA | Expected → received with gross/tax; income totals update |
| 2.4 Inbox: mark read, clear, filters, history | PAR-004 | S | OTA | Matches web semantics (`clearedAt`) |
| 2.5 Add-entry sheet: native date picker, searchable company list, live total, split preview, undo toast | UX-004, UX-010 | M | Build (date picker module) or OTA with a JS picker | Entry time and error rate measured on staging; screen-reader labels present |
| 2.6 Import preview and confirm; batch undo | UX-005 | M | OTA | Preview counts equal what is saved |
| 2.7 Monthly Picks: save shortlist and amount; search; sources | PAR-005 | S | OTA | Re-opening shows saved inputs; web sees them |
| 2.8 Accessibility pass: roles and composed labels on rows, chart summaries, signed amounts, no font shrinking | UX-002, UX-003 | M | OTA | TalkBack walk-through on every tab (device) |
| 2.9 Activity: virtualised month sections, filters, search; sold-out companies toggle on Holdings | UX-006, UX-009 | M | OTA | 1,000-entry staging fixture scrolls smoothly |
| 2.10 Single portfolio cache read via provider; async cache write; market card polls only when focused and in market hours | PERF-001, PERF-002, PERF-003 | S | OTA | One file read per launch (log); no market requests while on other tabs |
| 2.11 Tax status, backup export (share sheet), delete account (`DELETE /api/me`) | PAR-009, PAR-010, PAR-011 | M | OTA + web (+ Build if `expo-sharing` is new to the binary) | Delete removes all rows for the user on staging |

## Phase 3 · Cohesive visual redesign (Steady Steps)

Depends on 1.1 and 2.1. Follow `design-spec.md` and the prototype.

| Task | Effort | Ship | Acceptance check |
|---|---|---|---|
| 3.1 Tokens and kit: light/dark palettes, type scale, 48 dp targets, notices, chips, segmented control, sheets; `userInterfaceStyle: 'automatic'` | M | Build (theme setting), components OTA | All text pairs ≥ 4.5:1 (script); visual review in both themes |
| 3.2 Navigation: Today · Portfolio · Plan · Activity, bell → Inbox, avatar → More; Add action | M | OTA | Every existing route reachable; deep links still work |
| 3.3 Today screen (summary, this month, next actions, value vs money in, market) | M | OTA | Matches spec; states for empty, loading, error, offline |
| 3.4 Portfolio (Holdings / Insights) and Company (Ledger / Dividends) | M | OTA | — |
| 3.5 Plan (Targets / Monthly Picks, review-and-record sheet) | M | OTA | Record-all writes one revision |
| 3.6 Onboarding and import flow | S | OTA | New account reaches a plan in under five screens |
| 3.7 More (security, notifications, data, appearance, about; debug details moved off sign-in) | S | OTA | SEC-008 resolved |

## Phase 4 · Differentiated features needing new data

| Task | Dependency | Effort |
|---|---|---|
| 4.1 Money-in series and value-vs-money-in chart | New pure function; per-ticker history (exists) | M |
| 4.2 Money-weighted return (XIRR) with method note | New pure function + tests | S |
| 4.3 KSE-100 benchmark on matching cash flows | **New** daily index history table + scraper (pattern of `scripts/psx-history-scrape.mjs`), migration; price index only, labelled | L |
| 4.4 Live market stream on mobile (planned Phase 3 in `plans/mobile-app.md`) | `/api/market-stream` SSE client | M |
| 4.5 iOS build | Apple Developer membership, iOS OAuth client | L |

## Validation and release gates for every phase

1. **Local:** `cd mobile && npm ci && npm run typecheck && npm test`; root `npm ci && node --test 'tests/*.test.mjs'`; `npm run lint`; new pure functions get `node:test` coverage; the review harness (`harness/parity-fixtures.test.mjs`) is updated so F1–F8 assert the *fixed* behaviour.
2. **CI:** `Mobile app checks` and the root checks green on the PR.
3. **Staging:** the PR deploys to the staging Worker automatically; verify server changes there with the fictional seed account, never production data.
4. **Native device (Android staging build):** run the pending checks in `verification.md` for the screens touched (TalkBack, 200% font, 360 dp, offline, revoke, lock, push tap).
5. **OTA to staging:** `npm run update:staging -- --message "…"` only after 1–4; confirm the update id on the device.
6. **Production / production OTA / new native builds:** separately authorised by the owner each time. Tag a rollback branch first (project convention). Never spend an EAS build when an OTA would do; batch native changes (1.9 native part, 2.5 date picker, 2.11 sharing if needed, 3.1 theme setting) into one build.

## Suggested order of pull requests

1. Phase 1 server (1.4) · 2. Phase 1 client trust (1.1, 1.2, 1.3, 1.5, 1.8, 1.10, 1.12) · 3. SIP fixes (1.6, 1.7) + target editor (2.1) · 4. Dividends (2.2, 2.3, 2.4) · 5. Entry and import UX (2.5, 2.6) · 6. Accessibility and performance (2.8–2.10) · 7. Account data (2.11) · 8. Native build batch (1.9, 1.11, 2.5, 3.1) · 9. Redesign screens (3.2–3.7) · 10. Phase 4 items as separate PRs.
