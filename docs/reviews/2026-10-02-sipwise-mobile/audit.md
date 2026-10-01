# Sipwise mobile audit

Review date: 2026-10-02 (PKT). Code reviewed at `main` commit `a163355` ("Push test: show the real delivery error (#32)"), working tree clean.
Scope: `mobile/` (Expo SDK 57, React Native 0.86.3, Expo Router), the shared `lib/` modules it imports, the Worker API routes it calls, and the matching web screens in `app/`.

Every actionable item has a stable ID. **Classification** is one of *confirmed defect* (the code path is shown and, where possible, reproduced by the harness), *risk* (a plausible failure whose trigger or impact needs native or live verification), or *recommendation* (improvement, not a defect). Severities follow the plan: P0 evidenced critical exposure or destructive failure, P1 serious correctness/security/core-flow failure, P2 meaningful usability or reliability issue, P3 polish. Design taste is never counted as a defect.

**No P0 issue was found.** Native Android and iOS behaviour could not be run in this cloud session (see `verification.md`); any claim that depends on it is marked *native unverified*.

## 1. Summary of findings

| ID | Sev | Class | Title |
|---|---|---|---|
| FIN-001 | P1 | Confirmed defect | Holdings hero calls unrealised gain on open positions "all time" and "Return" |
| FIN-003 | P1 | Confirmed defect | SIP tab needs target weights that no screen can set; empty state is unreachable and its copy points to a web feature that does not exist |
| FIN-002 | P2 | Confirmed defect | Mobile "Portfolio value" drops priced holdings with unknown cost and still shows a gain when quotes are missing; web treats both differently |
| REL-002 | P2 | Confirmed defect | A budget typed on the SIP tab is saved to whichever month is showing after the arrows are used |
| REL-003 | P2 | Confirmed defect | "Refresh PSX prices" skips target companies that are not held, so SIP "Missing prices" cannot be fixed from the phone |
| PAR-002 | P2 | Confirmed defect | Mobile never turns PSX announcements into expected dividends or in-app alerts; that only happens when the web app is opened |
| PAR-003 | P2 | Confirmed defect | Expected (PSX auto) dividends cannot be marked received on mobile |
| SEC-001 | P2 | Risk | App lock overlay leaves portfolio content reachable by screen readers and visible in the app switcher |
| SEC-002 | P2 | Confirmed defect | In-memory query cache survives sign-out, so a second account on the same phone can briefly see the first account's devices, AI usage, Monthly Picks and price history |
| SEC-003 | P2 | Confirmed defect | When the server rejects the token (revoked or expired) the cached portfolio file and push preference stay on the phone |
| REL-001 | P2 | Confirmed defect | A transient database error during token check is answered with 401, and the app then deletes its token (forced sign-out) |
| SEC-004 | P2 | Risk | Signing out while offline leaves the server session and its push token active for up to 90 days |
| UX-001 | P2 | Confirmed defect | Primary button labels (3.68:1) and selected chips / Add pill (3.83:1) are below the 4.5:1 text contrast minimum |
| UX-003 | P2 | Confirmed defect | List rows and the lock button have no accessibility role; charts have no text alternative |
| UX-004 | P2 | Recommendation | Dates are typed as `YYYY-MM-DD` text and companies are picked from an unbounded chip wall |
| UX-005 | P2 | Recommendation | Imports save immediately with no preview or undo |
| FIN-004 | P3 | Confirmed defect | Monthly Picks "Run again" always forces a new paid run, even with identical inputs |
| FIN-005 | P3 | Confirmed defect | An unset budget is shown as PKR 100,000 (SIP hero and Picks amount) |
| FIN-006 | P3 | Confirmed defect | Reports hero "Gain" is unrealised only; the shared report already computes `grandTotalReturn` but mobile does not show it |
| FIN-007 | P3 | Confirmed defect | "Invested" means remaining cost on Holdings and this month's SIP buys on SIP |
| PAR-004 | P3 | Confirmed defect | Alerts cannot be marked read or cleared; no notification history |
| PAR-005 | P3 | Confirmed defect | Monthly Picks shortlist and amount are not saved on mobile (web saves both) |
| SEC-005 | P3 | Risk | `mobile/google-services.json` (staging Firebase client config with an API key) is committed but the build reads it from an env var instead |
| SEC-006 | P3 | Confirmed defect | The transaction route edits any entry id, including imported and PSX auto entries the UI marks read-only |
| SEC-007 | P3 | Recommendation | 90-day bearer token with no renewal ends in a silent sign-out |
| SEC-008 | P3 | Recommendation | Non-production sign-in screen prints package and client-id fragments |
| REL-004 | P3 | Risk | Last notification response is never cleared; a cold start may reopen the same company |
| REL-005 | P3 | Risk | A production build without env vars ships with an empty API URL and Google client id |
| UX-002 | P3 | Confirmed defect | Gain/loss relies on colour; positive amounts carry no sign; `adjustsFontSizeToFit` shrinks money under large text |
| UX-006 | P3 | Risk | Activity renders every ledger line in a ScrollView with no search, filter or virtualisation |
| UX-009 | P3 | Confirmed defect | Sold-out companies disappear from Holdings; their history is reachable only through Activity |
| UX-010 | P3 | Recommendation | Split entry has no preview of resulting shares and average cost (web has one) |
| PERF-001 | P3 | Risk | Each screen using `usePortfolio` re-reads and parses the cache file and recomputes holdings |
| PERF-002 | P3 | Risk | Full portfolio JSON is written synchronously to disk on every fetch and save |
| PERF-003 | P3 | Confirmed defect | Market card polls every 60 s while Holdings stays mounted behind other tabs |
| UX-007 | — | Recommendation | Navigation: Alerts holds a tab while Reports and Monthly Picks are buried under Account |
| UX-008 | — | Recommendation | Dark-only (`userInterfaceStyle: 'dark'`); no light theme or system setting |

Confirmed defects: 22 (2×P1, 10×P2, 10×P3). Risks: 8. Recommendations: 7 (not counted as defects; UX-004 and UX-005 carry P2 priority for planning).

Parity gaps recorded in `feature-parity.md` (missing capabilities, prioritised as recommendations): PAR-001 value-over-time chart (P3), PAR-007 edit company (P3), PAR-008 company-facts refresh request (P3), PAR-009 tax filer status (P3), PAR-010 backup export (P3), PAR-011 delete account, missing on both platforms though planned in `plans/mobile-app.md` §4.7 (P2).

## 2. Coverage inventory

Every mobile file and API dependency was read in full. "Result" links to the findings it produced, or records that nothing actionable was found.

| Subsystem | Mobile files | API / shared deps | Web counterpart | Result |
|---|---|---|---|---|
| Root, routing, query client | `app/_layout.tsx`, `app/(tabs)/_layout.tsx` | — | `app/page.tsx`, `TAB_PATHS` in `app/portfolio.tsx:101` | SEC-002, UX-007 |
| Sign-in | `src/screens/SignIn.tsx`, `src/auth/AuthProvider.tsx` | `POST /api/auth/mobile/google`, `lib/google-id-token.ts`, `lib/mobile-token.ts` | `app/sign-in.tsx`, Google OAuth routes | SEC-007, SEC-008; ID-token verification (sig, iss, aud, exp, email_verified) checked, no finding |
| Token storage | `src/auth/token-store.ts` | — | — | SecureStore for token and profile; no finding |
| Session check | — | `lib/auth.ts:30-34`, `lib/mobile-sessions.ts` | session cookie | REL-001 |
| Logout / devices | `app/(tabs)/account.tsx` | `/api/mobile-sessions`, `lib/mobile-current.ts` | — | SEC-003, SEC-004 |
| Biometric lock | `src/auth/BiometricLock.tsx`, `lock-policy.ts` | — | — | SEC-001, UX-003 |
| Portfolio data | `src/data/usePortfolio.ts`, `portfolio-cache.ts` | `GET/PUT /api/portfolio` (revision check) | `load()`/`save()` in `app/portfolio.tsx:392-530` | FIN-002, SEC-002, SEC-003, PERF-001, PERF-002; 409 handling sound |
| Derived views | `src/data/derive.ts` | `lib/portfolio.ts#holdings` | `app/portfolio.tsx:743-753`, `portfolio-value-card.tsx` | FIN-001, FIN-002 |
| Holdings | `app/(tabs)/index.tsx`, `src/ui/MarketPulse.tsx` | `/api/quotes`, `/api/market-summary` | Holdings tab | FIN-001, REL-003, PERF-003, UX-009 |
| Company | `app/company/[ticker].tsx`, `src/ui/LineChart.tsx` | `/api/price-history`, `lib/price-history.ts` | `app/company-detail.tsx` | PAR-003, UX-003 |
| Transactions | `app/transaction.tsx`, `src/data/mutations.ts` | `/api/quotes` symbol check | `record()`, `recordDividend()`, `recordStockSplit()` in `app/portfolio.tsx` | SEC-006, UX-004, UX-010; correction = void + insert matches web |
| Manual price | `app/quote.tsx` | — | quote dialog | No finding (future-date and >0 checks present) |
| Activity | `app/(tabs)/activity.tsx`, `src/ui/ActivityRow.tsx` | — | `app/ledger-timeline.tsx` | UX-006 |
| SIP planner | `app/(tabs)/sip.tsx`, `src/data/sip.ts` | `lib/portfolio.ts#plan` | none (web SIP tab is Monthly Picks) | FIN-003, FIN-005, FIN-007, REL-002, REL-003 |
| Monthly Picks | `app/picks.tsx` | `/api/recommendations`, `lib/monthly-picks.ts` | `app/monthly-picks.tsx`, `picks-*.tsx` | FIN-004, FIN-005, PAR-005; server single-active-run guard checked |
| Reports | `app/reports.tsx` | `lib/portfolio-reports.ts` | `app/portfolio-reports.tsx` | FIN-006 |
| Imports | `app/import.tsx`, `src/data/imports.ts` | `lib/ahl-import.ts`, `lib/cdc-import.ts` | Settings imports | UX-005; validate-before-save present |
| Alerts | `app/(tabs)/alerts.tsx` | portfolio `notifications` | `app/notifications-view.tsx`, bell | PAR-002, PAR-004 |
| Push | `src/push/push.ts`, `PushBridge.tsx` | `/api/mobile-push`, `/api/mobile-push/test`, `scripts/psx-payout-scrape.mjs` | — | SEC-004, REL-004 |
| Account / usage | `app/(tabs)/account.tsx` | `/api/usage`, `/api/mobile-sessions` | `app/settings-view.tsx` | SEC-002 |
| Theme / kit | `src/theme/tokens.ts`, `src/ui/kit.tsx`, `Icon.tsx` | — | `app/globals.css` | UX-001, UX-002, UX-003, UX-008 |
| Build config | `app.config.ts`, `eas.json`, `metro.config.js`, `google-services.json` | — | — | SEC-005, REL-005 |
| Tests | `src/**/*.test.ts` (6 files, 30 tests) | `tests/*.test.mjs` (34 files, 300 tests) | — | See `verification.md` |

Documentation: `mobile/README.md:5` points to `plans/mobile-app.md` "in the project files". That file is not in the repository but exists in the project's shared folder (`plans/mobile-app.md`, 13.8 KB) and was used as the intended-scope reference. Not a gap, but a link to it from the repo would help a new engineer.

## 3. Financial correctness and SIP (Step 03)

Calculations and their labels were checked separately. Shared calculation (`lib/portfolio.ts#holdings`, `plan`, `lib/portfolio-reports.ts`) is the same code on web and mobile, so arithmetic matches; the differences are in which numbers each screen sums and how they are labelled. Fixtures F1–F8 live in `harness/parity-fixtures.test.mjs` and all pass (see `verification.md`).

What was verified as correct in shared logic:

- Weighted-average cost includes buy fees; a sale removes cost at the running average and books `shares × (price − avg) − fees` as realised (`lib/portfolio.ts:844-854`). F1: buy 100 @ 50 + 50 fees, sell 40 @ 60 − 20 fees gives remaining cost 3,030 and realised 360.
- Unknown cost (opening without price) propagates as `null` through later buys until the position is closed (`lib/portfolio.ts:857-860`).
- Splits sort before trades on the same date; a quote dated before the latest split is ignored until a newer one arrives (`lib/portfolio.ts:340-349, 863-868`). F3 confirms.
- Dividends: expected (PSX auto) dividends are excluded from received income; reports count only `status === 'received'` (`lib/portfolio-reports.ts:242`). Neither hero figure includes dividends (F2).
- SIP allocation: whole shares, fee-inclusive unit cost rounded up to the paisa, never above the remaining budget, 20% cap of `priced value + remaining` (`lib/portfolio.ts:1325-1367`). F8: 26 shares at 97.84 (97.35 × 1.005, rounded up), leftover 20.32.
- Dates use Asia/Karachi (`lib/portfolio.ts:184-190`). Mobile reuses `today()` for defaults. Hermes `Intl` time-zone support on the installed build is *native unverified*.
- Duplicate submits: every write is a full-payload PUT guarded by `revision` (`app/api/portfolio/route.ts:67-85`). A second tap that slips through before the button disables loses the race with a 409, which the app turns into "Your portfolio changed… reloaded" (`mobile/src/data/usePortfolio.ts:66-69`). No duplicate ledger line can be written. A save whose response is lost to the 30 s client timeout also lands on this path.
- Monthly Picks: the server allows one active run per user and reuses a completed same-input same-day run unless `rerun` is true (`app/api/recommendations/route.ts:352-376`). Mobile polls `GET ?id=` every 4 s only while the run is active (`app/picks.tsx:66`), which is what advances the server state machine.

Concepts the plan asked about that do not exist in the product today: confirmed funds versus budget, saved (immutable) monthly plans, and contribution status. The SIP plan is recomputed live from the ledger every time; "already invested" is the sum of buys tagged to, or dated in, the month (`lib/portfolio.ts:1286-1295`). These are design proposals in `design-spec.md`, not defects.

### FIN-001 · P1 · Confirmed defect · "all time" label on unrealised gain

- Location: `mobile/app/(tabs)/index.tsx:63-84`, `mobile/src/data/derive.ts:24-40`.
- Evidence: the hero shows `totals.gain` followed by the word "all time" (line 72), and a "Return" stat (line 82). `totals()` sums `value − cost` over open positions only. Realised gains and dividends are not included. Fixture F1: the hero shows +270 while the position has also realised +360; the shared report's `grandTotalReturn` is 576 (after its tax estimate). The project README states "Returns are unrealised changes in the remaining holdings, not a total-return" (`README.md:26`), and the web labels the same number "Unrealised gain / loss" and its chart "Not total return: excludes realised gains and dividends" (`app/portfolio-value-card.tsx:98, 117`).
- Impact: the most prominent number on the phone overstates or understates lifetime performance whenever anything has been sold or paid a dividend, and it disagrees in meaning with the web for the same account.
- Fix: label it "Unrealised gain on current holdings"; drop "all time" and rename "Return". Add a separate, clearly defined total-return view (see §6).
- Verify: with fixture F1, the hero label reads unrealised; a total-return figure, if shown, equals realised + unrealised + received dividends and is labelled with its method.

### FIN-003 · P1 · Confirmed defect · SIP tab cannot be configured

- Location: `mobile/app/(tabs)/sip.tsx:136-180`; `lib/portfolio.ts:1303-1306`; `mobile/src/data/mutations.ts:121-139` (new companies get `target: 0`).
- Evidence: `plan()` adds "Target weights must total 100%." whenever targets do not sum to 100. With any error the "Suggested buys" block, including the "No targets yet" empty state, is hidden (line 138), so the empty state can never render (F7). Its copy tells the user to "Set target weights for your companies on the web app", but no web screen edits `target`: a search of `app/` finds targets only read (`app/picks-setup.tsx:53-54`, `app/portfolio.tsx:773`) and new companies are created with `target: 0` (`app/portfolio.tsx:1090, 1447`). Only legacy/seeded data or a restored backup has targets.
- Impact: one of five primary tabs shows an unexplained error for every account without legacy targets, which is every new account since the app became multi-user.
- Fix: add target-weight editing (mobile and web) with a running total and the 20% cap explained, or rebuild the SIP tab around the Monthly Picks shortlist the web already uses. Until then show a real empty state that explains what is missing.
- Verify: a new account opens SIP, sees a guided setup, sets targets that total 100%, and gets suggested buys.

### FIN-002 · P2 · Confirmed defect · Value and gain coverage differ from web

- Location: `mobile/src/data/derive.ts:31-35`; web `app/portfolio.tsx:743-753`, `app/portfolio-value-card.tsx:152-160`.
- Evidence: mobile skips a holding entirely when either price or cost is unknown. F4 (one priced holding with unknown cost): web value 4,300, gain "Not yet known"; mobile value 3,300 and gain +270. F5 (a held company with no quote): web gain `null`; mobile gain +270. Mobile adds a footnote (`index.tsx:86-88`), but the headline still reads "Portfolio value".
- Impact: two different "portfolio values" for one account; a partial gain presented as the gain.
- Fix: share one `portfolioSummary()` in `lib/` used by both clients: value of all priced holdings, cost only when complete, gain only when both are complete, plus explicit `incomplete` reasons. Label partial totals "Priced holdings · incomplete".
- Verify: F4 and F5 produce identical summaries on web and mobile.

### FIN-004 · P3 · Confirmed defect · "Run again" forces a paid run

- Location: `mobile/app/picks.tsx:138-143`.
- Evidence: after a completed run the button sends `rerun: true` regardless of whether amount, fee or shortlist changed, which bypasses the server's same-input reuse (`app/api/recommendations/route.ts:359`).
- Fix: send `rerun: true` only when the user explicitly asks for fresh research with unchanged inputs, and say it uses AI budget.
- Verify: tapping with unchanged inputs returns the cached run; no new `ai_usage` row.

### FIN-005 · P3 · Confirmed defect · Unset budget shown as PKR 100,000

- Location: `lib/portfolio.ts:1284`; `mobile/app/(tabs)/sip.tsx:89-91, 105`; `mobile/app/picks.tsx:88`.
- Fix: show "Not set" and ask for a budget; keep 100,000 only as a placeholder.

### FIN-006 · P3 · Confirmed defect · Reports "Gain" is unrealised

- Location: `mobile/app/reports.tsx:62-65`. `summary.totalGain` is unrealised; `summary.grandTotalReturn` (`lib/portfolio-reports.ts:474-477`) exists and is not shown.
- Fix: label "Unrealised gain"; add "Total return (realised + unrealised + received dividends, after estimated tax)" from `grandTotalReturn`.

### FIN-007 · P3 · Confirmed defect · "Invested" has two meanings

- Location: `mobile/app/(tabs)/index.tsx:76` (remaining cost) and `mobile/app/(tabs)/sip.tsx:92` (this month's SIP buys).
- Fix: "Cost of current holdings" and "Bought this month".

### Proposed metrics: what they need

| Metric | Method | Inputs | Available today? |
|---|---|---|---|
| Unrealised gain | `value − cost` of open priced holdings with known cost | ledger + quotes | Yes (`holdings`) |
| Realised gain | Σ sale gains at average cost | ledger | Yes (`holdings().realized`) |
| Received dividends | Σ gross (and net) with `status: received` | ledger | Yes (`taxSummary`) |
| Total return (PKR) | unrealised + realised + received dividends, before and after estimated tax | above | Yes (`grandTotalReturn` is after tax) |
| Net invested | Σ buy cost + fees − Σ sale proceeds | ledger | Computable in `lib/`, not yet exposed |
| Money-weighted return (XIRR) | cash flows = buys (−), sales and received dividends (+), terminal value (+) | ledger dates + current value | Computable from ledger; needs a new pure function and tests |
| Contribution history | Σ buys per month vs budget | ledger + `budgets` | Yes (`portfolioReport().monthlyActivity`) |
| Benchmark (KSE-100 price index) | Same cash flows invested in KSE-100 on each buy date; compare ending value | daily KSE-100 closes for the whole holding period | **No.** `/api/market-summary` only carries the current session series. Needs a stored daily index history (scraper + table), stated as a *price* index; KSE-100 total-return data is not available from the current sources |

Benchmarks must use the same dates and cash flows as the portfolio, say "price index, dividends excluded", and stay hidden until enough history exists. No historical series is fabricated in the prototype; benchmark visuals there are labelled illustrative.

## 4. Security, data lifecycle and reliability (Step 04)

What is sound: Google ID tokens are verified for RS256 signature, issuer, audience, expiry and verified email (`lib/google-id-token.ts:37-97`); app tokens are HMAC-signed with `aud: "mobile"` and a device-session id checked on every request (`lib/mobile-token.ts`, `lib/auth.ts:30-34`); revocation clears the push token (`lib/mobile-sessions.ts:78-84`); per-user isolation is by `identity()` email on every route read; bearer requests skip the cookie origin check by design (`lib/server.ts:9`); token and profile live in SecureStore; the portfolio payload is capped at 4 MB and validated server-side after enrichment; push tokens are format-checked. The Firebase **admin** key file is listed in the root `.gitignore` and is not tracked (`git ls-files` checked). No secret values were read or reproduced.

### SEC-001 · P2 · Risk · Lock overlay is not a privacy barrier

- Location: `mobile/src/auth/BiometricLock.tsx:85-89`; no `FLAG_SECURE` / app-switcher cover anywhere in `mobile/`.
- Evidence: the lock is drawn as an `absoluteFill` view over the still-mounted app, without `accessibilityViewIsModal` (iOS) or `importantForAccessibility="no-hide-descendants"` on the content (Android). The comment says this is intentional to keep half-typed forms. Screen-reader focus can therefore move to underlying values; the OS app-switcher snapshot shows the last screen.
- Preconditions: app lock on, device in someone else's hands with TalkBack/VoiceOver on, or the recents screen visible.
- Fix: hide content from accessibility while locked; blur/cover on `inactive`/`background`; consider `FLAG_SECURE` as an opt-in.
- Verify (native): with TalkBack on and the lock shown, swipe navigation reaches only "Unlock"; recents thumbnail shows a cover.

### SEC-002 · P2 · Confirmed defect · Query cache survives sign-out

- Location: `mobile/app/_layout.tsx:48` (one `QueryClient` for app lifetime); `mobile/src/auth/AuthProvider.tsx:52-62` (no `queryClient.clear()`); query keys without the user: `['devices']`, `['usage']`, `['recommendations']`, `['recommendation', id]`, `['history', ticker]`, `['market-summary']`.
- Evidence: after account A signs out and account B signs in in the same process, these queries render A's cached data until the refetch finishes. Monthly Picks additionally sets `runId` from A's latest run (`app/picks.tsx:56-60`); the follow-up `GET ?id=` returns 404 for B.
- Preconditions: two Google accounts used on one phone without killing the app. Low likelihood for a private app; data is the user's own or the household's.
- Fix: `queryClient.clear()` in `clearLocal`, and include the email in every user-scoped query key.
- Verify: sign in as A, open Account and Picks, sign out, sign in as B: no A data is ever painted.

### SEC-003 · P2 · Confirmed defect · Revoked token leaves local data

- Location: `mobile/src/auth/AuthProvider.tsx:52-57, 63` versus the manual path `mobile/app/(tabs)/account.tsx:197-203`.
- Evidence: only the button path calls `clearPortfolioCache`; the 401 path (device revoked from another phone, token expired) clears the token but leaves `cache/portfolio-<email>.json` and `sipwise.push = 1`. The next account to sign in on that phone inherits the push preference and is auto-registered by `PushBridge.tsx:17-19` without opting in.
- Fix: move cache and preference cleanup into `clearLocal`.
- Verify: revoke the phone from another device; after the forced sign-out the cache file is gone and the preference is off.

### SEC-004 · P2 · Risk · Offline sign-out leaves the session live

- Location: `mobile/src/auth/AuthProvider.tsx:59-62` (`.catch(() => {})` on the DELETE), `src/push/push.ts:65-67`.
- Evidence: when offline, the server-side session and its push token remain until expiry (90 days, `lib/mobile-token.ts:7`). The phone keeps receiving dividend pushes for an account it shows as signed out.
- Fix: queue the revoke and retry on next launch; tell the user when it could not be completed; list the device as "sign-out pending" on other devices.
- Verify: airplane mode → sign out → reconnect → relaunch: the session is revoked within one launch.

### REL-001 · P2 · Confirmed defect · Database hiccup signs the phone out

- Location: `lib/mobile-sessions.ts:54-56` returns `false` on any error; `lib/auth.ts:33` turns that into "no user"; routes answer 401; `mobile/src/api/client.ts:46` calls `onUnauthorized`, which deletes the token (`AuthProvider.tsx:52-57`).
- Impact: a transient D1 error during any request forces a full Google sign-in again.
- Fix: distinguish "session revoked" (401) from "could not check" (503); only 401 clears the token.
- Verify: unit test where the session lookup throws expects 503, and the client keeps its token on 503.

### REL-002 · P2 · Confirmed defect · Budget saved to the wrong month

- Location: `mobile/app/(tabs)/sip.tsx:18, 66, 105, 45-52`.
- Evidence: `budgetText` is not reset when `month` changes. Type 50,000 in October, tap next month, tap Save: November's budget becomes 50,000 and October is unchanged.
- Fix: key the draft by month (or reset it on month change) and show the month in the Save label.
- Verify: the sequence above leaves November untouched until its own value is typed.

### REL-003 · P2 · Confirmed defect · Price refresh misses SIP targets

- Location: `mobile/src/data/usePortfolio.ts:42-46` refreshes only `view.open`; `lib/portfolio.ts:1298-1302` requires prices for held **and** targeted companies. The SIP tab has no refresh control.
- Fix: refresh `companies.filter(shares > 0 || target > 0)` (and the Picks shortlist) and add the action to the SIP screen.

### PAR-002 · P2 · Confirmed defect · Dividend announcements depend on the web

- Location: web `app/portfolio.tsx:400, 413-470` (`recordAutoDividends` on every load); mobile receives `announcements` in `PortfolioResponse` but never uses them (no reference in `mobile/`).
- Impact: a push says a company announced a payout, but the Alerts tab says "You're all caught up" and the company ledger shows no expected dividend until the web app is opened somewhere.
- Fix: move the pending-auto-dividend step into a shared `lib/` function and run it on mobile load (with the same 409 retry), or better, do it server-side once in the payout scraper so no client has to.
- Verify: with a fresh announcement and only the phone in use, the expected dividend and its alert appear.

### PAR-003 · P2 · Confirmed defect · No "Mark received"

- Location: `mobile/src/data/derive.ts:90` (only `manual` dividends are editable); web `app/portfolio.tsx:1004-1025` and `app/company-detail.tsx:475`.
- Fix: add Mark received (payment date, gross, tax withheld) on the company page and from the alert.

### SEC-005 · P3 · Risk · Committed Firebase client config

- Location: `mobile/google-services.json` (added in #32; contains `project_info` and one Android client for `com.uzairbukhari.sipwise.staging` with an `api_key`; values not reproduced). `mobile/app.config.ts:83` reads `GOOGLE_SERVICES_JSON` from EAS instead, so the committed file is not what builds use.
- Assessment: Firebase Android API keys are client identifiers, not secrets, but they should be restricted (Android app + SHA-1) in Google Cloud. Committing one that the build does not use only creates confusion.
- Fix: either delete it and keep the EAS file variable, or use it deliberately and document it. Confirm the key restriction in Google Cloud Console.

### SEC-006 · P3 · Confirmed defect · Edit route ignores read-only rule

- Location: `mobile/app/transaction.tsx:62-74`. The company page only links editable entries, but `/transaction?id=…` (deep link scheme `sipwise-staging://`) loads any trade, dividend or split.
- Fix: refuse to edit entries where `editable` is false, or route them to the correct action (Mark received for auto dividends).

### SEC-007 · P3 · Recommendation · Token renewal

90-day expiry (`lib/mobile-token.ts:7`) with no sliding renewal ends in a 401 and a full sign-out. Re-issue a token when less than 30 days remain on a successful request.

### SEC-008 · P3 · Recommendation · Debug details on sign-in

`mobile/src/screens/SignIn.tsx:42-53` prints package name, part of the Google client id and the update id on staging/dev builds. Move behind a long-press or an About screen.

### REL-004 · P3 · Risk · Notification re-open

`mobile/src/push/PushBridge.tsx:29` reads `getLastNotificationResponseAsync()` on every mount; the de-dupe set is in memory only. On Android the last response can persist across launches, so a later cold start may navigate to the same company again. Call `clearLastNotificationResponseAsync()` after handling. *Native unverified.*

### REL-005 · P3 · Risk · Empty production config

`mobile/app.config.ts:56, 100`: production `api` is `API_BASE_URL ?? ''` and the Google web client id is `''` unless env vars are set. A production build or OTA without the EAS production environment would ship a non-working app. Fail the config when a production variant lacks them.

## 5. Native UX, accessibility and performance (Step 05)

Walked from source (no device available). Each journey lists friction and the finding it maps to.

| Journey | Friction | IDs |
|---|---|---|
| First run / sign-in | Single button, good. No explanation of what is stored or that data syncs with the web. New account lands on an empty Holdings; SIP shows an error. | FIN-003, UX-007 |
| Import | Hidden under Account → Tools. File applies immediately; result is a one-line message. No preview of trades/companies being added. | UX-005, UX-007 |
| Daily portfolio check | Hero is clear but mislabelled; partial totals look complete; market card disappears silently on error; no value-over-time chart (web has one). | FIN-001, FIN-002, PAR-001 |
| Record a trade | Kind chips, company chip wall, free-text ISO date, free-text SIP month; no running total (shares × price + fees); no confirmation of what will be saved. | UX-004 |
| Correct / void | Works and keeps the audit trail; only reachable from the company page; imported/auto entries silently not tappable. | PAR-003, SEC-006 |
| Company | Good cards and chart; chart has no axis values, no accessible summary; "Set price" is a peer of "Add transaction". | UX-003 |
| SIP | Error-first for most accounts; month arrows unbounded; "Use older quotes" switch without explaining which quotes; fee field not persisted. | FIN-003, REL-002, REL-003 |
| Monthly Picks | Clear progress text and resumable; cost of a run not stated; chips list every company; results long cards. | FIN-004, PAR-005 |
| Reports | Read-only list of bars; useful but dense; tax prompt sends user to the web. | FIN-006 |
| Alerts | Read-only; cannot mark read or clear; announcements missing unless web opened. | PAR-002, PAR-004 |

### UX-001 · P2 · Confirmed defect · Contrast

Computed with WCAG relative luminance from `mobile/src/theme/tokens.ts`: white on `primary #3b82f6` = **3.68:1** (all primary buttons, 15 px semibold, `kit.tsx:160,170`); `primary` text on `primarySoft` over card = **3.83:1** (selected chips `kit.tsx:206-208`, Holdings "Add" pill `index.tsx:44-55`, SIP Picks banner). Android guidance requires 4.5:1 for text under 18 sp (source list §7). Muted text passes (6.1–7.9:1). Fix with the palette in `design-spec.md` (primary `#1d4ed8` gives 6.70:1 with white).

### UX-002 · P3 · Confirmed defect · Colour-only gains, shrinking numbers

`Amount` (`kit.tsx:113-119`) colours by sign; positive values are printed without "+", so gain vs loss on list rows (`index.tsx:131`) depends on colour or the minus sign alone. `adjustsFontSizeToFit` with `numberOfLines={1}` shrinks money under large font scales instead of wrapping. Fix: always sign changes (+/−), add an arrow glyph, allow two lines.

### UX-003 · P2 · Confirmed defect · Roles and labels

`ListRow` (`kit.tsx:267-271`) is a `Pressable` with no `accessibilityRole="button"` or combined label, so TalkBack announces fragments ("MEB", "MEBL", "1,000 shares…"). The lock screen's Unlock (`BiometricLock.tsx:101-105`) and device "Sign out" (`account.tsx:184`) lack roles. `LineChart` (`LineChart.tsx:409`) and the market sparkline expose nothing; give them a summary label ("1 month, from 312 to 338, up 8.3%"). Tab icons rely on the tab label (fine).

### UX-004 · P2 · Recommendation · Data entry

Dates (`transaction.tsx:234`, `quote.tsx:54`) and SIP month (`transaction.tsx:252`) are typed text. Company choice is a chip for every company in the ledger (`transaction.tsx:216-224`). Use a native date picker with "Today" default, a searchable company sheet with recent companies first, and a live total line.

### UX-005 · P2 · Recommendation · Import preview

`import.tsx:30-35` validates then saves in one step. Show counts and the first rows (new companies, trades, skipped duplicates, replaced PSX estimates), then Confirm. Keep the pre-import revision so the user can undo by voiding the batch.

### UX-006 · P3 · Risk · Long ledgers

`activity.tsx:24-33` maps every entry inside the shared `ScrollView` (`kit.tsx:32`). With multi-year AHL imports this means hundreds of rows rendered at once. Use `FlatList`/`SectionList` by month, with search and type filters. *Performance not measured.*

### UX-007 · Recommendation · Navigation

Tabs today: Holdings, SIP, Activity, Alerts, Account. Monthly Picks lives under SIP (banner) and Account (Tools); Reports and Import only under Account. Alerts is a low-frequency inbox occupying a tab. See the proposed navigation in `design-spec.md`.

### UX-008 · Recommendation · Theme

`app.config.ts:76` forces dark; the palette is dark-only (`tokens.ts:1`). Offer light, dark and system.

### UX-009 · P3 · Confirmed defect · Sold-out companies

`openPositions` (`derive.ts:42-46`) hides zero-share companies; the web has a "Show sold out" toggle (`app/portfolio.tsx` holdings toolbar). Mobile users can reach their history only via Activity.

### UX-010 · P3 · Recommendation · Split preview

Show "120 shares at avg 25.25 after split" before saving, as the web does (README workflow step 3).

### Performance

- **PERF-001 · P3 · Risk.** `usePortfolio()` keeps its own `cached` state and `useEffect` disk read per instance (`usePortfolio.ts:14-22`) and its own `useMemo` view. With five tabs plus a pushed screen, the payload is read and parsed up to six times at start and holdings recomputed per screen. Lift the cache read into a provider or seed it with `queryClient.setQueryData` once.
- **PERF-002 · P3 · Risk.** `writePortfolioCache` (`portfolio-cache.ts:20-25`) serialises and writes the full payload synchronously on the JS thread after every fetch and save (payload limit is 4 MB server-side).
- **PERF-003 · P3 · Confirmed defect.** `MarketPulse` (`MarketPulse.tsx:442-447`) has a 60 s `refetchInterval`; bottom tabs keep Holdings mounted, so it keeps polling while the user is on other tabs (paused only when the app is backgrounded). Tie it to screen focus (`useIsFocused`) and market hours.
- Charts are simple SVG paths computed per render; cheap at current series lengths. No measurements were possible.

Native checks that remain pending (cannot be decided from source): TalkBack/VoiceOver order on every screen, 200% font scale layout, 360 dp width layout, back gesture behaviour in modals, keyboard covering inputs on Android (`KeyboardAvoidingView` uses `height` on Android), safe areas on gesture-nav devices, biometric prompt AppState transitions, notification channel behaviour.

## 6. Public research sources (accessed 2026-10-02)

Official platform guidance:

- Android Developers, "Make apps more accessible": 48×48 dp minimum touch target; 4.5:1 contrast for text under 18 sp (or bold under 14 sp), 3:1 for larger text; content descriptions for every interactive element. https://developer.android.com/guide/topics/ui/accessibility/apps
- Material Components for Android, BottomNavigation docs: "Navigation bars can have three to five destinations"; set a title on each item for TalkBack. https://github.com/material-components/material-components-android/blob/master/docs/components/BottomNavigation.md (the m3.material.io page requires JavaScript and could not be read by the fetch tool: https://m3.material.io/components/navigation-bar/guidelines)
- Apple, "UI Design Dos and Don'ts": controls at least 44×44 pt; text at least 11 pt; ample contrast. https://developer.apple.com/design/tips
- W3C WCAG 2.2 SC 2.5.8 Target Size (Minimum), 24×24 CSS px, as quoted at https://wcag22aa.org/new-criteria/target-size/
- Apple HIG Tab bars and Accessibility pages (https://developer.apple.com/design/human-interface-guidelines/tab-bars, …/accessibility) could not be fetched in this session (permission prompt timed out). They are not relied on for any claim.

Product examples (observed from public help pages; marketing claims not counted):

- Wealthsimple, "Access your enhanced performance insights": separates current value, net deposits, all-time return, unrealised return, realised returns and dividends earned, with period filters; offers time-weighted and simple return rate. https://help.wealthsimple.com/hc/en-ca/articles/37275467470235
- Wealthsimple, "Understanding returns and performance metrics": explains time-weighted vs money-weighted return and net deposits in plain language. https://help.wealthsimple.com/hc/en-ca/articles/360058461213
- Wealthsimple, "View the historical value of your investing accounts": value plotted against net deposits with time-range tabs. https://help.wealthsimple.com/hc/en-ca/articles/24935139558299
- Trading 212, "Pies & AutoInvest – Introduction": each slice has a target percentage; recurring money goes "first to the slices that are below their target percentage" (self-balancing), with schedule choices. https://helpcentre.trading212.com/hc/en-us/articles/30661163244317
- Vanguard, "Performance details": personal return differs from published fund return because of timing, fees and taxes; recommends comparing against a relevant index. https://investor.vanguard.com/investor-resources-education/portfolio-management/performance-details

Patterns taken forward: label every return by what it includes; show money put in next to value; make the monthly contribution a first-class object with target slices; compare against an index only with matching cash flows and an explicit caveat.
