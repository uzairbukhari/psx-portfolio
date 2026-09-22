# Research-driven SIP — cross-session progress checklist

Brief: `../../../reviews/CLAUDE-IMPLEMENTATION-BRIEF.md` (relative to repo root: `../reviews/CLAUDE-IMPLEMENTATION-BRIEF.md`)
Audit: `../reviews/2026-09-22-sip-research-review.md`

This file is the single source of truth for cross-session resumption. Each milestone gets its own
detailed plan doc (written just before that milestone starts, since later milestones' exact design
depends on how earlier ones land) at `docs/superpowers/plans/2026-09-22-m<N>-<slug>.md`, executed via
superpowers:subagent-driven-development or superpowers:executing-plans.

**Hard rules for every milestone (from the brief — do not violate):**
- Never seed/reset/replace/write-test against the real localhost account (`.dev.vars` / local D1). All
  mutation tests use isolated fixtures.
- Preserve all trades, corrections/voids, dividends, unknown cost bases, source metadata, legacy
  imports, score rubrics, dossier history. Never convert unknown → zero.
- No deployment, no production migration, no push. Local validation + deployment notes only.
- New policy settings are additive, previewable, explicitly activated — never silently change saved
  targets/approvals/research conclusions.
- Run at each milestone: `node --test tests/*.test.mjs`, `npx tsc --noEmit`, `npm run lint`,
  `npm run build`. Record pre-existing failures separately; never claim a skipped check passed.

## Milestone status

- [x] **Milestone 1 — Correct inconsistent inputs and outputs** (COMPLETE 2026-09-22)
  - Plan: `2026-09-22-m1-consistent-valuation-quotes-evidence.md` (9 tasks, all reviewed clean)
  - SDD ledger (rulings, review verdicts, full history): `.superpowers/sdd/2026-09-22-m1-consistent-valuation-quotes-evidence/progress.md`
  - [x] Task 1: `lib/valuation.ts` shared scenario module (commit 2246986)
  - [x] Task 2: `lib/quotes.ts` shared effective-quote module (commit dcc85d6)
  - [x] Task 3: wire valuation into `lib/portfolio.ts` (researchInsights, reviewPrompt, researchContext) (commit 1e92a51)
  - [x] Task 4: wire valuation into dossier save + legacy import (commit b2c7715)
  - [x] Task 5: wire valuation into AI-run completion + dossier validation (commit 556c716)
  - [x] Task 6: fix name-based scenario display + upside/discount in original-dossier.tsx (commit 0febd47)
  - [x] Task 7: effective quotes in portfolio GET + AI-review cache fingerprint (DB migration) (commit bb8dbbb; migration `drizzle/0009_puzzling_greymalkin.sql` applied to local dev D1 after explicit user confirmation)
  - [x] Task 8: scope evidence verification to cited document/page; bank N/A distinction (commit c31cc6d)
  - [x] Task 9: verification sweep, browser check, PROGRESS/README update (commit 30d60c7)
  - [x] Final whole-branch review (opus): Ready to merge = Yes, 0 Critical, 3 Important, 6 Minor.
    2 Important findings fixed + scoped-re-reviewed clean (commit cc1e6b8: `valuationProvenance`
    wasn't set at the AI-run-completion write site, and dossier save could mislabel a cleared
    scenario model's own prior output as "legacy"). 3rd Important finding (evidence-scoping now
    hard-fails synthesis on an unselected-but-cited page) confirmed to need no code change — the
    existing self-correction retry loop already surfaces the new error back to the model; flagged
    as an operational watch-item, not a defect. Minor findings deferred (see SDD ledger) — none
    block merge or change any saved holding/target/approval/research conclusion.
  - **Final commit: `cc1e6b8`**
- [ ] **Milestone 2 — Research-driven monthly plan** (split into 2a/2b — 2a covers the decision contract & policy, 2b covers allocation/cash/AI role since those need 2a's assessment function first)
  - [x] **2a — Shared decision contract + policy preview** (COMPLETE 2026-09-22 — plan: `2026-09-22-m2a-decision-contract-and-policy.md`, 7 tasks, all reviewed clean)
    - SDD ledger: `.superpowers/sdd/2026-09-22-m2a-decision-contract-and-policy/progress.md`
    - [x] Task 1: sync dossier stance onto ResearchCompany (commit 8bddf3a)
    - [x] Task 2: Shariah screening evidence + approved max price on Company (commit a27148a)
    - [x] Task 3: ResearchPolicy type + inactive-by-default settings (commit b90d669, 1 fix round)
    - [x] Task 4: `lib/decision.ts` — assessCompany/assessAll (commit 78a3b9d, 2 fix rounds — real eligibility gaps found and closed: date→revision-counter redesign for supersession check, Pending-screening exclusion, unpriced-holding sector-exposure guard, plus a 2nd round closing a gap the 1st round's fix itself introduced)
    - [x] Task 5: company dialog UI for screening/max price/research-version approval (commit 6c8a8ba)
    - [x] Task 6: policy preview UI with explicit activation (commit 2ff7962)
    - [x] Task 7: verification sweep (125/125 tests, tsc clean, 26 pre-existing lint errors confirmed unrelated, build succeeds), browser-verified read-only against the real account: policy preview renders with correct per-company exclusion reasons (0/25 eligible — expected, since screening/stance/max-price are all-new empty fields nobody has populated yet), company dialog's 5 new fields render correctly. Did not click "Activate" (would flip a real saved setting) or save any company edit.
    - [x] Final whole-branch review (opus): Ready to merge = "With fixes", 0 Critical, 4 Important, 11 Minor.
      All 4 Important findings fixed + scoped-re-reviewed clean (commit 10dc30b): screening `source`/`effectiveDate`
      were never checked (a record with a blank source and no effective date passed), the supersession check was
      inert for every never-explicitly-approved company (i.e. every company on the real account today — fixed
      with a distinct "not yet approved" exclusion reason), `ResearchCompany.status` was ignored (a dossier
      flagged "Update needed" with a stale Consider stance still passed), and `stance` promotion was inconsistent
      across the 3 write sites with no stated rationale (now explicit: legacy import carries it through as prior
      human research, the AI-run route deliberately does not, with a comment explaining why). 11 Minor findings
      deferred (NaN policy-arg guard, floating-promise activate handler, draft-state resync on reload, cosmetic
      styling, etc.) — none block merge, none affect real account data today (still 0/25 eligible either way).
    - **Final commit: `10dc30b`**
  - [ ] **2b — Allocation and cash + AI role** (split into 2b-i/2b-ii/2b-iii)
    - [x] **2b-i — Funding and cash model** (COMPLETE 2026-09-22 — plan: `2026-09-22-m2b-i-funding-and-cash.md`, 5 tasks, all reviewed clean; final whole-branch review not yet run — see note below)
      - SDD ledger: `.superpowers/sdd/2026-09-22-m2b-i-funding-and-cash/progress.md`
      - [x] Task 1: FundingEntry type + Portfolio.funding? + validation (commit 724c152)
      - [x] Task 2: confirmedFunds pure derived function (commit ad63ace)
      - [x] Task 3: funding entry manager UI in Monthly SIP tab (commit 77a2fa4)
      - [x] Task 4: "Mark as reinvested" action on dividends (commit 3862309)
      - [x] Task 5: regression fixture 9 (commit pending), 136/136 tests, tsc clean, 26 pre-existing
        lint errors confirmed unrelated, build succeeds. Browser-verified once (real account, read-only):
        "Confirmed funds" section renders correctly (Rs 0, as expected — no entries yet), "Mark as
        reinvested" button renders on real MEBL dividend rows with correct computed net amounts. Did
        not click either action against the real account.
      - **Note (2026-09-22):** per explicit user instruction, per-task/per-subplan interactive browser
        checks are now DEFERRED to one consolidated pass later — automated verification (`node --test`,
        `tsc`, lint, build) and the per-task subagent code reviews continue unchanged at every task and
        every sub-plan (these are fast/automated and are how correctness gets verified along the way,
        not what was asked to be deferred). Each sub-plan's own **final whole-branch review** is also
        rolled up: rather than one per sub-plan, a single final whole-branch review will cover 2b-i+2b-ii+
        2b-iii together once 2b-iii lands, since they're tightly sequential (2b-ii builds directly on
        2b-i's `confirmedFunds`, 2b-iii on 2b-ii's allocator) and reviewing them together catches the
        same cross-task issues a per-sub-plan review would, without re-covering already-settled ground
        three times.
    - [x] **2b-ii — Research-driven allocator + Save plan** (COMPLETE 2026-09-22 — plan: `2026-09-22-m2b-ii-allocator-and-save-plan.md`, 4 tasks, all reviewed clean)
      - SDD ledger: `.superpowers/sdd/2026-09-22-m2b-ii-allocator-and-save-plan/progress.md`
      - [x] Task 1: `researchPlan()` sector-aware allocator in lib/decision.ts (commit e83c6ae, 1 fix round — real
        money-allocation bugs found and closed in the plan's own sample code: a sector cap that could be
        doubled by two same-sector companies in the first pass, and a fairness bug where identical companies
        got wildly unequal shares (200/100/0/0) purely from list order. Verified with unusually deep rigor:
        two independent high-scrutiny reviews, each reconstructing the pre-fix code to prove new tests
        actually catch the bugs, plus 12,000+ fuzzed portfolios with zero cap breaches across both rounds.)
      - [x] Task 2: `SavedPlan` type + `Portfolio.savedPlans?` + validation (commit fa3400f)
      - [x] Task 3: `saveResearchPlanSnapshot()` capture function (commit fcc29ab)
      - [x] Task 4: verification sweep — 146/146 tests, tsc clean, 26 pre-existing lint errors (one genuine
        new one from Task 3, a stray unused import, caught here and fixed directly — commit f8b626b), build
        succeeds. No interactive browser check this sub-plan, per standing instruction (deferred to the
        consolidated pass after 2b-iii).
    - [ ] **2b-iii — AI role + Monthly SIP UI wiring** (plan not yet written — depends on 2b-ii's allocator)
      - [ ] AI role: explanation-only, comparison candidates outside shortlist, remove 5–8 company cap
      - [ ] Wire the research-driven plan into the Monthly SIP tab display when policy is active
- [ ] **Milestone 3 — Decision board, comparison and learning tab**
  - [ ] Decision board + compare 2–4 companies
  - [ ] Sector-specific checklists (bank / E&P / industrial / REIT-ETF-takaful-holding)
  - [ ] "Understand this company" glossary tab (works without AI, deterministic examples)
- [ ] **Milestone 4 — Targeted evidence updates and decision history**
  - [ ] Resolve research gaps (targeted reprocessing within existing cost bounds)
  - [ ] Proposed old/new value diff + versioned history + readiness re-evaluation
  - [ ] Interim vs. annual labelling, comparability flags
  - [ ] Saved monthly decisions vs. actual purchases view

## Regression fixtures (from brief §"Regression fixtures and verification") — track as they're implemented

1. [ ] 5 Watchlist companies, 20% target, priced at 2x fair value → new policy allocates zero, with reasons. (Milestone 2 — needs the eligibility contract, not yet built)
2. [x] Legacy EFERT-style dossier (13×8, 16×10, 19×12), null summary values → all surfaces show 104/160/228. Unit-tested (`tests/valuation.test.mjs`) AND confirmed live against the real EFERT dossier in the browser check: Bear 104 / Base 160 / Bull 228, Base styled correctly by name.
3. [x] Base value 500, price 550.98 → change ≈ -9.25%, never labelled upside. Unit-tested AND confirmed live: real MEBL dossier at price 550.98 shows "Overvalued 9.25%" in the AI-review coverage table (`researchInsights`).
4. [ ] Overweight MEBL-like holding + overweight sector → no new contribution to either; no sell record. (Milestone 2 — needs the allocation/headroom logic, not yet built)
5. [ ] Consider dossier with paused purchase flag → remains excluded. (Milestone 2 — needs the eligibility contract)
6. [x] New quote cache value, no portfolio revision change → dashboard & review share it; cached explanation invalidated. Code-verified (Task 7, reviewed clean: shared `mergeEffectiveQuotes`, SHA-256 `quote_fingerprint` column added to the AI-review cache key) — not exercised live this session since doing so would trigger a real, billed OpenAI call; the migration is applied and the wiring order was independently confirmed by the task reviewer.
7. [x] Financial number found only on wrong document/page/year → unverified. Unit-tested (`tests/research-evidence.test.mjs`, `tests/research-policy.test.mjs`): wrong-page and wrong-document cases both correctly return unverified. Same-page-different-year column attribution within one six-year table remains a documented, honest limitation (not claimed as solved — see Task 8's plan notes).
8. [ ] Multiple eligible companies, one sector, expensive shares, fees, small budget, ties → deterministic, no breaches, no negative residuals. (Already covered for the *existing* target-based `plan()` by pre-existing tests; the *research-driven* version is Milestone 2)
9. [ ] Unknown cash, confirmed rollover, reinvested dividend, corrected/voided purchase → no fabricated/double-counted spend capacity. (Milestone 2 — needs funding/carry-forward records)
10. [x] Modified scenario/research, save/reload, legacy import, cross-user request → consistent values, preserved history, correct access control. Consistent-value round-trip confirmed by Tasks 3–6's tests + the live browser check (same 104/160/228 and same "Overvalued 9.25%" language everywhere it's surfaced); user isolation/access control was not modified by Milestone 1 and remains as `lib/server.ts#identity()` already enforced it.

## Session log

- 2026-09-22: Brief received, repo surveyed (clean tree, real routes confirmed beyond old CLAUDE.md's
  "single route" claim). Milestone 1 code survey dispatched. This progress file created.
- 2026-09-22: Milestone 1 fully implemented via superpowers:subagent-driven-development (9 tasks, each
  with a fresh implementer + independent task reviewer; all approved clean, no fix loops needed). Full
  verification: `node --test tests/*.test.mjs` 105/105 pass; `npx tsc --noEmit` clean; `npm run lint`
  shows 26 pre-existing errors, all confirmed via git history to predate this session and to be outside
  every file this milestone touched (`lib/portfolio.ts:672` specifically checked against commit
  `23abbf7`, well before this milestone's base); `npm run build` succeeds. One DB migration
  (`drizzle/0009_puzzling_greymalkin.sql`, additive-only `ai_reviews.quote_fingerprint` column) was
  generated, validated against isolated copies of both local D1 sqlite files, then applied to the real
  local dev D1 only after explicit user confirmation (AskUserQuestion) — portfolios row counts (2 and 1
  across the two local D1 files) confirmed unchanged before/after. Browser-verified read-only against
  the real local account: opened the real EFERT dossier (Bear/Base/Bull 104/160/228, Base styled
  correctly by name, "Overvalued 13.02% ... 14.98% premium to base-case value" — both signs correct);
  the AI-review Coverage step's research-evidence table shows MEBL at price 550.98 as "Overvalued
  9.25%" (fixture 3, live); the exported ChatGPT prompt no longer contains the hardcoded "Prior research
  as of 2026-09-10" paragraph, replaced by a live "CURRENT DOSSIER SNAPSHOT". Did not trigger a real AI
  review (would spend real OpenAI credit without being asked). No deployment; nothing pushed. Nothing
  about real holdings, targets, approvals or research conclusions was changed — only how existing saved
  scenario/quote/evidence data gets computed and displayed.
- Milestone 2 (research-driven monthly plan) is next. Its shared decision contract depends on nothing
  further from Milestone 1 that isn't already in place.
