# Verification

Environment: Claude Code cloud container (Linux), Node v22.22.0, npm 10.9.4, repo `uzairbukhari/psx-portfolio` at `a163355`, branch `claude/project-thread-5i9ffu`, clean tree. No Android emulator, no iOS simulator, no physical device, no EAS access. Neither `node_modules` (root or `mobile/`) was installed, and none was installed for this review (scope: no dependency changes). No live API was called, no account data was read or written, no Monthly Picks or research run was started, nothing was deployed or published over the air.

## Commands and outcomes

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Mobile unit tests | `cd mobile && npm test` (`node --test --experimental-strip-types 'src/**/*.test.ts'`) | **Passed**: 30 tests, 0 failed (api client, derive, imports, mutations, SIP, lock policy) |
| 2 | Mobile type check | `cd mobile && npm run typecheck` | **Blocked**: `TS6053 File 'expo/tsconfig.base' not found` and missing `@types/node`, because `mobile/node_modules` is not installed. Indirect evidence only: GitHub Actions "Mobile app checks" (`.github/workflows/mobile-check.yml`: type check, tests, bundle) **passed** on run #25 for the head of PR #32 (`340d598`), which is the content merged as `a163355`: https://github.com/uzairbukhari/psx-portfolio/actions/runs/36917097168 |
| 3 | Root test suite | `node --test 'tests/*.test.mjs'` | 298 passed, **2 files failed to load**: `tests/mobile-auth.test.mjs` and `tests/portfolio-route.test.mjs` import the `typescript` package, which is a root devDependency not installed here (`ERR_MODULE_NOT_FOUND`). Environment issue, not an app failure |
| 4 | Those two files with the preinstalled TypeScript | temporary git-ignored symlink `node_modules/typescript → /opt/node22/lib/node_modules/typescript`, run, symlink removed | **Passed**: 14 tests, 0 failed (mobile token sign/verify, audience separation, bearer parsing; portfolio route revision/409, quote merge isolation). Tree clean afterwards |
| 5 | Parity and SIP fixtures (review harness) | `node --test --experimental-strip-types docs/reviews/2026-10-02-sipwise-mobile/harness/parity-fixtures.test.mjs` | **Passed**: 8 tests (F1–F8 below) |
| 6 | Prototype rendering | Playwright (preinstalled Chromium) over 17 screens/states × widths 360/412 × text 100%/160% × light/dark = 136 renders, checking elements outside the phone frame and horizontal scroll | First pass found 18 overflow cases at 160% text (wrapping rows, chips); fixed; **final pass 0 problems, 0 console errors** |
| 7 | Contrast | WCAG relative-luminance script on current and proposed tokens | Current: white on primary 3.68:1, primary on primarySoft 3.83:1 (fail for small text). Proposed palette: every text pair ≥ 4.5:1 (lowest: light `gain` on `gain-soft` 5.04:1) |

Relevant root tests that ran inside #3 and passed: `portfolio`, `portfolio-reports`, `allocation`, `ahl-import`, `finqalab-import`, `auto-dividends`, `dividends-expected`, `dividend-push`, `notifications`, `monthly-picks`, `monthly-picks-flow`, `monthly-picks-ai`, `session`, `shared-lib`, `price-history`, `quote-cache`, `rate-limit`.

## Fixtures (harness, illustrative data)

| Fixture | Expectation | Outcome |
|---|---|---|
| F1 buy 100 @ 50 + 50 fees, sell 40 @ 60 − 20 fees, price 55 | Web and mobile agree: value 3,300, cost 3,030, unrealised +270; realised +360 not in the "all time" hero; report `grandTotalReturn` 576 | Pass (supports FIN-001) |
| F2 F1 + received dividend 500 | Neither hero includes dividends; `grandTotalReturn` 1,001 | Pass |
| F3 1→2 split after the trades, quote dated before split | Shares 120; value `null` until a quote on/after the split; then 3,300 | Pass |
| F4 extra holding with unknown cost and a price | Web value 4,300, gain `null`; mobile value 3,300, gain +270 | Pass (confirms FIN-002) |
| F5 extra holding with no quote | Web gain `null`; mobile gain +270 | Pass (confirms FIN-002) |
| F6 empty portfolio | Both 0; mobile gain % `null` | Pass |
| F7 SIP with no targets | `plan().errors` contains "Target weights must total 100%."; unset budget = 100,000 | Pass (confirms FIN-003, FIN-005) |
| F8 SIP, 5 × 20% targets, budget 10,000, fee 0.5% | Whole shares; fee-inclusive unit rounded up (97.35 → 97.84); invested ≤ remaining; overweight MEBL gets "Already at or above target" | Pass |

## Claim reconciliation

- Every confirmed defect in `audit.md` cites a file and line that was read at `a163355`. Five are additionally reproduced by fixtures (FIN-001, FIN-002, FIN-003, FIN-005, and the shared-calculation checks). REL-002, SEC-002, SEC-003, REL-001, PERF-003 and UX-001 are confirmed by code path or calculation, not by running the app.
- Removed during reconciliation: an early suspicion that a double-tapped Save could write duplicate ledger lines (the revision check makes the second write fail with 409; recorded as sound in audit §3); and a suspicion that the web lacked a "Show sold out" option (it has one, so UX-009 is a mobile-only gap).
- Downgraded: SEC-001 and REL-004 are risks, because their impact depends on native behaviour not observed here.
- Severity check: no P0. The two P1s are core-trust and core-flow failures (headline label, unconfigurable primary tab), each with a fixture.

## Scenario table

| Scenario | Status | Basis |
|---|---|---|
| Offline launch shows cached portfolio | Not run (native) | Code: `usePortfolio.ts:16-22, 34`, `AuthProvider.tsx:77-83` keep the saved profile and cache |
| Interrupted save (timeout after server commit) | Not run | Code: 30 s abort (`api/client.ts:33-34`) then 409 path on next save; message tells user to check Activity |
| Duplicate submit | Passed by analysis | Server revision check (`app/api/portfolio/route.ts:75-85`), covered by `tests/portfolio-route.test.mjs` |
| Session expiry / revocation | Partly verified | Token expiry and audience tests pass (#4); client 401 handling read in code; local data left behind (SEC-003) |
| Transient DB error during auth | Not run | Code path shows forced sign-out (REL-001) |
| Large ledger (1,000+ entries) | Not run | Source-level risk only (UX-006, PERF-001/002) |
| Account switch on one phone | Not run | Code path (SEC-002) |
| TalkBack / VoiceOver order and labels | **Blocked** (no device) | Source review only (UX-003, SEC-001) |
| 200% font scale on device | **Blocked** | Prototype checked at 160% in a browser; app not |
| 360 dp device layout | **Blocked** | Prototype checked at 360 px in a browser; app not |
| Biometric prompt and AppState | **Blocked** | — |
| Push delivery, channel, tap-to-open | **Blocked** | Server test endpoint exists; not called (would send to live devices) |
| Google native sign-in | **Blocked** | Requires a development or EAS build |
| iOS anything | **Blocked** | No iOS build exists yet |

## What this does not prove

Passing unit tests and a green CI type check do not show that the installed Android build behaves correctly end to end. The prototype is an HTML design artifact rendered in desktop Chromium; it is not the React Native app and says nothing about native rendering, gestures, fonts or accessibility services.

## Pending native checks for the implementation phase

On the Android staging build: TalkBack pass on every tab and sheet; font scale 200%; 360 dp width; lock screen with TalkBack and recents thumbnail; offline launch and offline write attempt; revoke this phone from another device; sign out offline then reconnect; notification tap from killed state twice; large-ledger scroll (import a 1,000-row fixture into a test account on staging only).
