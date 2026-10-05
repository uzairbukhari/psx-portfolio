# Sipwise mobile audit and visual redesign — Claude handoff

Date: 2026-10-02 (Asia/Karachi)  
Status: READY TO START — audit and visual design have not been performed.  
Project root: `/Users/uahmed/Documents/ChatGPT PSX Research/portfolio-dashboard`  
Mobile app: `mobile/`  
Overall progress: `[----------] 0%` — 0 of 10 steps complete.

## 1. Mission and authorized scope

Perform a thorough, evidence-backed review of the React Native mobile app, compare it with the web app, and deliver a polished visual redesign proposal and actionable implementation roadmap. Evaluate correctness, security, reliability, feature coverage, UI, UX, accessibility, performance, and product usefulness.

User decisions already settled:

- Primary product: PSX stock portfolio and SIP tracking; indices provide market context and benchmarks, not a pivot to an index-fund-only product.
- Audience: both the owner's advanced workflow and newer PSX investors.
- Platform: Android first, iOS ready.
- Design freedom: full redesign of navigation, layouts, colors, and light/dark themes while retaining the Sipwise name/identity.
- Deliverable: comprehensive audit **plus visual redesign**, not just a written checklist.

This assignment authorizes review documents, local illustrative prototypes, and verification. It does **not** authorize app/backend changes, dependency upgrades, commits/pushes, migrations, native releases, OTA updates, deployments, paid AI research, or writes to saved live accounts. Continue all independent review work if device access or another verification method is unavailable. Document the limit; do not invent verification.

## 2. Read first and establish current truth

Read repository `CLAUDE.md`, `README.md`, `mobile/README.md`, and any applicable `AGENTS.md` before work. Treat code and current configuration as the implementation evidence; documentation can be stale.

Initial orientation, verified during planning but requiring confirmation at audit time:

- Mobile uses Expo/React Native and Expo Router; web uses Next.js-style routes through vinext on Cloudflare Worker/D1.
- Mobile shares pure calculation modules from `lib/` via `@shared/*` and uses the same backend API family.
- Mobile tabs are Holdings, SIP, Activity, Alerts, and Account. Additional routes cover company detail, quotes, Monthly Picks, reports, imports, and transactions.
- `mobile/src/theme/tokens.ts` explicitly derives the dark palette from the web app. Inspect actual rendered results before judging visual quality.
- Existing mobile tests cover API client, derived data, imports, mutations, SIP, and lock policy; backend/shared tests live under `tests/`.
- `mobile/README.md` references `plans/mobile-app.md`, which was absent during planning. Search for an alternate document; if none exists, record the documentation gap.
- Google native sign-in requires an appropriate development/native build, not Expo Go. Do not assume a browser preview proves native behavior.
- Current repository guidance describes multi-user access, super-admin research controls, revision-based stale-write rejection, and a changed Monthly Picks flow. Reconfirm these rather than importing older assumptions about private-only access or historical research workflows.

Do not read or reproduce secret values in reports, logs, screenshots, or prototypes. Assess credential handling by file metadata, ignore/tracking rules, references, and redacted inspection only as necessary.

## 3. Progress protocol and deliverables

Use this file as the single progress tracker. Update it after completing a checkpoint and before ending a work session. Each step has four checkboxes, each worth 25% of that step. Use these exact bars:

`[----------] 0%` · `[##--------] 25%` · `[#####-----] 50%` · `[#######---] 75%` · `[##########] 100%`

Overall percentage = completed checkpoints / 40 × 100, rounded to the nearest whole percent. Steps are equally weighted for tracking, not an estimate of time or effort. Status is `NOT STARTED`, `IN PROGRESS`, `BLOCKED`, or `COMPLETE`. A documented blocked verification is not a passed test. A step can finish with an explicit verification limitation if its investigation and handoff are complete; mark affected claims unverified.

| Step | Workstream | Status | Progress |
|---|---|---|---|
| 01 | Baseline and review inventory | NOT STARTED | `[----------] 0%` |
| 02 | Web/mobile feature parity | NOT STARTED | `[----------] 0%` |
| 03 | Financial correctness and SIP | NOT STARTED | `[----------] 0%` |
| 04 | Security, data lifecycle, reliability | NOT STARTED | `[----------] 0%` |
| 05 | Native UX, accessibility, performance | NOT STARTED | `[----------] 0%` |
| 06 | External design research and direction | NOT STARTED | `[----------] 0%` |
| 07 | Screen specifications and design system | NOT STARTED | `[----------] 0%` |
| 08 | Annotated visual prototype | NOT STARTED | `[----------] 0%` |
| 09 | Validation and evidence reconciliation | NOT STARTED | `[----------] 0%` |
| 10 | Prioritized roadmap and final handoff | NOT STARTED | `[----------] 0%` |

Save outputs under `docs/reviews/2026-10-02-sipwise-mobile/`:

- `README.md`: executive assessment, deliverable links, verification limits, and highest-priority actions.
- `audit.md`: technical findings, UX review, coverage inventory, evidence, and public research sources.
- `feature-parity.md`: web/mobile matrix and recommended placement of each capability.
- `design-spec.md`: recommended design direction, journeys, screen specifications, and component/state rules.
- `prototype/index.html` with local assets: responsive, annotated visual concepts; self-contained where practical, no backend calls or real account data.
- `verification.md`: commands, outcomes, fixtures, native/browser observations, and unavailable checks.
- `implementation-roadmap.md`: ordered future implementation tasks, dependencies, acceptance checks, and release gates.

For every actionable issue, assign a stable ID such as `FIN-001`, `SEC-001`, `UX-001`, or `PAR-001`. Record severity, classification (confirmed defect / risk / recommendation), exact relative path and line, evidence or reproduction, impact, fix recommendation, and verification criterion. Use P0 only for an evidenced critical exposure or destructive failure; P1 for serious correctness/security/core-flow failures; P2 for meaningful usability or reliability issues; P3 for polish. Do not treat taste as a software defect.

## 4. Execution steps

### Step 01 — Establish baseline and inventory

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Read applicable instructions/domain rules; record commit, working-tree status, Node version, and app/tool versions without changing user work.
- [ ] Inventory every mobile route, component, data/auth/push layer, API dependency, shared module, and corresponding web entry point.
- [ ] Inspect existing tests and available Android/iOS builds, emulator/device access, and safe preview options; record what is actually available.
- [ ] Create output documents and a review coverage inventory linking each subsystem to its eventual findings or no-finding result.

Done when the audit has a bounded coverage map and reproducible baseline. Do not mistake this orientation for a completed review.

### Step 02 — Compare mobile and web features

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Trace web and mobile support for holdings, company detail, trades, corrections/voids, dividends, splits, quotes/history, imports, reports, and settings.
- [ ] Trace SIP, saved plans/history, contributions, research eligibility, Monthly Picks, notifications/history, roles, and account/session controls.
- [ ] Classify each capability as complete, partial, missing, intentionally web-only, or mobile-specific, citing both implementations and material differences.
- [ ] Recommend parity or deliberate divergence based on user journeys; distinguish an existing feature that is hard to find from an absent one.

Done when `feature-parity.md` covers all discovered screens and user-visible web capabilities. Do not force desktop administration or complex research authoring into primary mobile navigation.

### Step 03 — Audit financial correctness and SIP

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Trace totals, cost basis, fees, realized/unrealized gains, dividend treatment, split ordering, valuation completeness, stale prices, and date/time conventions through shared logic and screen labels.
- [ ] Compare mobile/web results for identical fixtures: buy/sell with fees; partial sale; dividend expected versus received; split before/after trades; unknown cost; missing/stale quote; empty portfolio.
- [ ] Verify SIP budget versus confirmed funds, caps, whole shares, rounding, unallocated cash, saved plan immutability, contribution status, eligibility, and duplicate actions; verify current Monthly Picks evidence and recovery rules.
- [ ] Document mismatches, misleading labels, and unavailable metrics; specify required inputs/methods for proposed total-return, contribution, and benchmark views.

Done when calculations and their presentation have been checked separately. In particular, investigate whether a label such as “all time” represents only open-position unrealized gain; do not declare the issue resolved or confirmed from the label alone. Benchmark recommendations must specify comparable periods, price versus total return, and data availability; never fabricate historical series.

### Step 04 — Audit security, synchronization, and reliability

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Trace native sign-in, token storage, expiry/revocation, biometric lifecycle, logout/account switching, API authorization, role restrictions, and per-user isolation.
- [ ] Review disk/query caches, cache naming and cleanup, data validation, interrupted requests, revision conflicts, duplicate submits, retries, and offline recovery without writing to live accounts.
- [ ] Inspect import limits/validation, push permissions and registration/logout, notification deep links, API environments, EAS/OTA configuration, and secret/build inclusion boundaries.
- [ ] Record concrete attack/failure preconditions, existing mitigations, remaining risks, and targeted verification for every finding; check dependency posture without upgrades.

Done when each lifecycle has an evidence-backed assessment. Do not infer exposure merely because a sensitive file exists locally; verify tracking/build inclusion and access implications without disclosing contents.

### Step 05 — Review native UX, accessibility, and performance

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Walk onboarding/import, portfolio check, transaction entry/correction, company exploration, SIP planning, Monthly Picks, reports, and alerts. Record actual native observations where possible.
- [ ] Evaluate navigation, hierarchy, information density, financial language, discoverability, charts, loading/empty/error/offline states, destructive confirmations, and recovery.
- [ ] Assess screen-reader names/order, focus, scalable text, contrast, non-color signals, touch targets, safe areas, keyboard/back behavior, and Android/iOS differences.
- [ ] Review large-list rendering, polling/background activity, chart costs, cache writes, and unnecessary renders; distinguish measured performance from source-level risk.

Done when every core journey has friction points and recommendations. Capture small-screen and enlarged-text evidence if runnable. If not, list those exact native checks as pending; source inspection cannot establish visual pass/fail.

### Step 06 — Research and select the design direction

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Review current official Android/Material and Apple accessibility/navigation guidance; cite direct URLs and access dates.
- [ ] Examine 3–5 relevant public investing/product examples for portfolio clarity, contributions, benchmarks, onboarding, and progressive disclosure. Separate observed patterns from marketing claims.
- [ ] Choose one distinctive Sipwise direction with rationale: calm financial clarity, legible numbers, clear next actions, and advanced detail available on demand.
- [ ] Define the proposed navigation and main journeys for novice and advanced users, including where Research and Monthly Picks belong.

Done when one recommended direction is selected and justified. Avoid competing unfinished themes, generic dashboard decoration, unsupported “best app” claims, or copying another brand.

### Step 07 — Specify screens and a reusable design system

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Define light/dark palettes, type scale, numeric styles, spacing, surfaces, icons, target sizes, motion/reduced-motion behavior, and accessible chart rules.
- [ ] Specify overview, holdings/company detail, SIP, market/benchmarks, activity/add transaction, and onboarding/import: purpose, hierarchy, actions, navigation, data needs, and states.
- [ ] Specify supporting alerts, account/privacy, reports, quotes, research, and Monthly Picks surfaces so the redesign covers the whole existing app.
- [ ] Map each proposed metric or feature to existing data, reusable calculations, or a genuine backend/model dependency; document minimum interface changes only for concrete needs.

Done when a builder can implement each proposed screen without inventing its purpose or financial meaning. Values must distinguish planned/actual, expected/received, partial/complete valuation, and stale/current information.

### Step 08 — Build annotated visual concepts

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Create six coherent populated mobile concepts matching Step 07, including company detail and the transaction-entry flow within their respective experiences.
- [ ] Add representative first-use/empty, loading, error/retry, offline/stale, import preview, and successful-save treatments; include light/dark examples.
- [ ] Make the local prototype navigable across the core journey, with theme/state controls and annotations explaining hierarchy, interaction, and data assumptions.
- [ ] Inspect the rendered prototype at 360px and 412px widths and enlarged text; capture useful previews, fix prototype layout issues, and label all data illustrative.

Done when the user can see and navigate the recommendation, not merely read a description. A browser prototype is a design artifact, not a React Native implementation or native verification. All buttons must either demonstrate a local interaction or clearly identify themselves as illustrative.

### Step 09 — Validate evidence and reconcile findings

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Run existing mobile `npm run typecheck` and `npm test`; record exit results and failures without modifying app code to make checks pass.
- [ ] Run relevant existing root tests for portfolio/reports, allocation, imports, mobile auth/session, portfolio route/concurrency, notifications/push, and current Monthly Picks behavior; broaden only for a concrete gap.
- [ ] Reconcile parity fixtures and native/browser observations with every claim; remove duplicates, false positives, outdated assumptions, and unsupported severity.
- [ ] Complete a verification table separating passed, failed, not run, and blocked checks, including offline, interruption, duplicate submit, session expiry, large data, and accessibility scenarios.

Command starting points (confirm environment and scripts first):

```sh
# From portfolio-dashboard/mobile
npm run typecheck
npm test

# From portfolio-dashboard; select existing relevant files discovered in Step 01
node --test tests/portfolio.test.mjs tests/portfolio-reports.test.mjs tests/allocation.test.mjs tests/mobile-auth.test.mjs tests/portfolio-route.test.mjs
```

Do not install packages, initialize live services, or rerun paid workflows just to satisfy a check. Use isolated fixtures/local harnesses in the review output directory if needed. Avoid live GET endpoints that advance research or mutate state; inspect endpoint behavior before calling. Report pre-existing failures separately from audit tooling failures.

Done when all conclusions have a traceable basis and limitations are explicit. Build success or passing unit tests must not be presented as end-to-end native success.

### Step 10 — Deliver the implementation roadmap and handoff

Progress: `[----------] 0%` · Status: NOT STARTED

- [ ] Rank the work into correctness/security/trust, core journey usability, cohesive visual redesign, and differentiated product features; link tasks to stable finding IDs.
- [ ] For every phase specify dependencies, affected subsystems, acceptance checks, migration/API needs if any, relative effort, and what can ship independently.
- [ ] Define future implementation validation and release gates: local checks, native device flows, staging verification, and separately authorized production/OTA release.
- [ ] Complete the executive assessment, link every artifact, update this tracker honestly, and give the user a concise handoff with top findings, prototype entry point, limitations, and next action.

Done when another engineer can pick up the roadmap without repeating the audit. Recommend priorities rather than implementing app changes. Do not call the audit “complete” with missing deliverables; mark remaining work explicitly.

## 5. Resume and reporting protocol

At the start of each session, read this plan, inspect current files, and resume the first incomplete checkpoint. Do not restart completed work unless code or evidence changed. Preserve existing user changes. Keep progress updates short and focused on findings and remaining uncertainty.

After each step, add a short entry below with: date, completed work, artifact/evidence links, limitations, and next checkpoint. Checkboxes, step bars, summary table, and overall progress must agree. Keep design recommendations out of the confirmed-defect count.

### Session log

- 2026-10-02: Handoff plan created from the approved scope. Repository guidance and initial structure inspected for planning only. No audit tests, native verification, feature audit, or visual prototype completed. Next: Step 01.

### Final completion checklist

- [ ] All ten steps and forty checkpoints accounted for accurately.
- [ ] Every mobile screen and relevant web feature represented in the coverage/parity inventory.
- [ ] Findings carry evidence, severity, location, impact, and a concrete verification criterion.
- [ ] Six visual experiences, supporting-screen specifications, state treatments, and light/dark direction delivered.
- [ ] Existing-test results and native verification limits stated accurately.
- [ ] Roadmap separates existing-data improvements from new data/service dependencies.
- [ ] No unauthorized app changes, live data writes, paid research, or releases performed.
