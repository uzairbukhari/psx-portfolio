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
  - [ ] **2a — Shared decision contract + policy preview** (plan: `2026-09-22-m2a-decision-contract-and-policy.md`, 7 tasks, in progress)
    - [ ] Task 1: sync dossier stance onto ResearchCompany
    - [ ] Task 2: Shariah screening evidence + approved max price on Company
    - [ ] Task 3: ResearchPolicy type + inactive-by-default settings
    - [ ] Task 4: `lib/decision.ts` — assessCompany/assessAll (the single assessment function)
    - [ ] Task 5: company dialog UI for screening/max price/research-version approval
    - [ ] Task 6: policy preview UI with explicit activation
    - [ ] Task 7: verification sweep, browser check, docs
  - [ ] **2b — Allocation and cash + AI role** (plan not yet written — depends on 2a landing)
    - [ ] Shared assessment-driven allocator (replaces plan()'s eligibility rule when policy active)
    - [ ] Funding/carry-forward records, confirmed-funds vs planned-budget separation
    - [ ] Save plan snapshot (immutable, point-in-time)
    - [ ] AI role: explanation-only, comparison candidates, remove 5–8 company cap
    - [ ] Monthly SIP tab UI wiring of the research-driven plan
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
