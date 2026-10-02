# AHL import and dividend sync — progress

Plan: `docs/ahl-import-dividend-sync-plan.md`

Last updated: 2026-10-02 (Asia/Karachi)

## Current status

**Handoff prepared. Implementation not started.** Repository and statement were inspected during planning; no feature implementation or verification has been performed by this handoff.

Overall accepted implementation progress: **0%** `[--------------------]`

Progress is the sum of weights of stages whose acceptance gates have passed. An in-progress stage earns no completion weight until its gate passes. Record useful partial work in the log without inventing percentages.

| Stage | Weight | Status | Evidence required |
| --- | ---: | --- | --- |
| 1. Contracts, fixtures, baseline | 10% | Not started | Baseline results, fixtures, compatibility checks |
| 2. AHL PDF parser | 20% | Not started | Actual extraction path, 61 trades, totals/date tests |
| 3. Reconciliation, IPO, import review | 25% | Not started | Idempotency, overlap, inferred acquisitions, browser save |
| 4. Historical refresh and eligibility | 20% | Not started | Refresh status, calendar/holdings, isolation checks |
| 5. Bulk received-dividend review | 15% | Not started | Bulk approval, unknown dates, reconciliation/reload |
| 6. End-to-end and release handoff | 10% | Not started | Tests, type/lint/build, browser, release instructions |

## Acceptance checklist

- [ ] Read repository guidance and inspect current changes; preserve unrelated work.
- [ ] Record baseline checks and distinguish pre-existing failures.
- [ ] Add anonymized fixtures and backward-compatible metadata.
- [ ] Parse and reconcile the supplied PDF through the production extraction path.
- [ ] Verify historical calendars and settlement-date conversion.
- [ ] Prevent duplicates across repeated/overlapping PDF and JSON imports.
- [ ] Preserve legitimate identical fills and resolve ambiguous matches.
- [ ] Implement IPO evidence lookup, labelled fallback, and acquisition corrections.
- [ ] Complete import preview and atomic revision-checked saving.
- [ ] Add per-company refresh status and environment-safe workflow dispatch.
- [ ] Calculate historical entitlement, including sold holdings and splits.
- [ ] Add dividend multi-select and approve-as-received behavior.
- [ ] Support unknown payment dates without inventing taxes/net amounts.
- [ ] Reconcile existing/CDC dividends and preserve approved entries on reload.
- [ ] Verify mobile/shared-contract compatibility.
- [ ] Complete automated and browser checks with recorded results.
- [ ] Document configuration, migration, release, and rollback requirements.

## Confirmed planning findings

- Existing AHL import accepts JSON; Finqalab already uses browser PDF extraction.
- Supplied four-page PDF has 61 trades: 52 buys, 9 sells, 24 symbols.
- PDF contains settlement dates and fee-inclusive displayed rates.
- JSRR sale lacks an acquisition in this statement; user selected IPO lookup then labelled sale-price/day-before fallback.
- Dividend approval must mean received; actual payment date may be unknown.
- Existing forward-only automatic dividend tracking cannot directly serve historical backfill.
- Current calendar inspection showed complete-year coverage only for 2026; verify historical coverage before date inference.
- Checkout contains ongoing unrelated changes. Another plan/tracker already exists for Monthly Picks; do not overwrite it.

## Work log

| Date/time (PKT) | Stage | Work completed | Evidence / remaining work |
| --- | --- | --- | --- |
| 2026-10-02 | Handoff | Saved approved requirements, stages, and tracker | No implementation tests run |

## Verification log

Record exact command or browser scenario, environment, result, and relevant failure detail. Do not paste secrets or personal statement content.

| Check | Result | Evidence |
| --- | --- | --- |
| Feature implementation tests | Not run | Implementation has not started |
| Type check / lint / build | Not run | Implementation has not started |
| Browser workflows | Not run | Implementation has not started |
| External refresh / IPO integration | Not run | Access and configuration not yet verified |

## Decisions and deviations

No deviations yet. Record any necessary change here with its reason and effect on acceptance criteria. Do not silently weaken duplicate handling, accuracy, provenance, or user-selected receipt behavior.

## Blockers and release requirements

- No confirmed implementation blocker yet; required external credentials/configuration have not been verified.
- Official historical settlement calendars and IPO evidence require verification.
- Production workflow dispatch, remote migration, deployment, and real-portfolio imports are outside the authorized verification scope.
- Record exact database migration/configuration steps here once implemented.

## Resume instructions

1. Read the plan and repository guidance.
2. Inspect `git status` and shared-file diffs; preserve ongoing unrelated work.
3. Begin Stage 1 with baseline tests and compatibility contract inspection.

Next concrete action: inspect the current AHL import, PDF extraction, dividend validation, and calendar tests; record baseline results before implementation.

## Final handoff (fill when finished)

- Implemented behavior:
- Changed subsystems:
- Passed checks:
- Failed or unverified checks:
- Required migrations/configuration:
- Release order:
- Rollback strategy:
- Remaining work:
