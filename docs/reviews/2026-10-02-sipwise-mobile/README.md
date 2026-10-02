# Sipwise mobile audit and redesign (2026-10-02)

Audit and design proposal for the Expo/React Native app in `mobile/`, reviewed at `main` `a163355`. No app, backend, data or deployment changes were made.

## Executive assessment

The mobile app is a solid, small codebase (about 3,400 lines) that reuses the web's calculation code, so its arithmetic matches the web. Authentication is well built: Google ID tokens are fully verified, app tokens are bound to revocable device sessions, and every write is protected against stale overwrites. The weak points are what the numbers are called, one primary tab that cannot be set up, and a set of lifecycle gaps around sign-out and dividends.

**No P0 found. Two P1s:**

1. **FIN-001.** The Holdings headline shows unrealised gain on open positions but labels it "all time" and "Return". Realised gains and dividends are not in it. The web labels the same figure correctly.
2. **FIN-003.** The SIP tab needs target weights that neither app can edit. For any account without legacy targets it shows "Target weights must total 100%", and its empty state, which points to a web feature that does not exist, can never appear.

**Notable P2s:** mobile totals drop holdings with unknown cost and still show a gain when a price is missing (FIN-002); a typed budget can be saved to the wrong month (REL-002); PSX dividend announcements only become expected dividends and alerts when the web app is opened (PAR-002), and they cannot be marked received on the phone (PAR-003); sign-out and token rejection leave cached data, push preference and the in-memory cache behind (SEC-002, SEC-003); a transient database error signs the phone out (REL-001); primary button text contrast is 3.68:1 (UX-001).

Totals: 22 confirmed defects (2 P1, 10 P2, 10 P3), 8 risks, 7 recommendations, plus parity gaps. Full list: [audit.md](audit.md).

## Deliverables

| File | What it is |
|---|---|
| [audit.md](audit.md) | Findings with IDs, severity, evidence, fix and verification; coverage inventory; financial, security, UX and performance review; public sources |
| [feature-parity.md](feature-parity.md) | Web vs mobile matrix with placement recommendations |
| [design-spec.md](design-spec.md) | "Steady Steps" direction, navigation, design tokens, screen specs, states, data map |
| [prototype/index.html](prototype/index.html) | Annotated, navigable visual prototype (self-contained). Open in a browser; previews in `prototype/previews/` |
| [verification.md](verification.md) | Commands, results, fixtures, scenario table, unavailable checks |
| [implementation-roadmap.md](implementation-roadmap.md) | Phased tasks linked to finding IDs, acceptance checks, release gates |
| [handoff-plan.md](handoff-plan.md) | The original plan with its progress tracker completed |
| [harness/parity-fixtures.test.mjs](harness/parity-fixtures.test.mjs) | Review harness comparing mobile and web summaries on fixtures |

The prototype is also published as a private page: https://claude.ai/artifact/L8E7LfXMvSYg5omkDN6La5

## Verification limits

Native Android and iOS testing was not possible in this cloud session (no emulator, simulator or device). Every native claim is marked unverified. Mobile tests (30) and the root suite (300, two files needing the `typescript` package were run with the preinstalled copy) pass; the mobile type check could not run without installing dependencies, and CI's last green run on the same code is cited instead. The prototype is a browser design artifact checked at 360 and 412 px and 160% text, not the React Native app.

## Highest-priority actions

1. Ship one shared portfolio summary and correct labels on both apps (roadmap 1.1, 1.2).
2. Clear all local state on every sign-out path and stop signing users out on server hiccups (1.3, 1.4).
3. Fix the SIP month/budget bug and price refresh scope, then add a target editor so the SIP tab works for everyone (1.6, 1.7, 2.1).
4. Record PSX dividends server-side and add Mark received and alert actions on mobile (2.2–2.4).
5. Then build the Steady Steps redesign in one native build batch plus OTA screens (Phase 3).
