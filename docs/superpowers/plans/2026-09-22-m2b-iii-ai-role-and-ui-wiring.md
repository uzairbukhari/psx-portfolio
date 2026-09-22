# Milestone 2b-iii — AI role and Monthly SIP UI wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the research-driven policy and allocator (2b-i, 2b-ii) actually visible and usable — the Monthly SIP tab shows `researchPlan()`'s output (eligibility reasons, confirmed-funds-bounded spend) instead of the legacy `plan()` output when the policy is active, a "Save plan" button freezes an immutable snapshot, and the AI review gets richer context (assessments, comparison candidates, no more arbitrary 5-8 company cap) — without ever letting the AI set eligibility, invent evidence, or bypass the deterministic allocator. This is the last sub-plan of Milestone 2b; it's also where the whole milestone's work actually becomes visible to the user for the first time.

**Architecture:** `app/api/review/route.ts` gains: the 5-8 restriction removed, `researchPlan()`/`assessAll()` context supplied to the model (only when the policy is active — otherwise byte-identical to today's behavior, preserving legacy compatibility), and comparison-candidate context. `app/portfolio.tsx`'s Monthly SIP tab computes `researchPlan()` alongside the existing `plan()` call when `p.researchPolicy?.enabled`, and switches the "Suggested purchase breakdown" table and the "Available this month" summary to the research-driven numbers when active — `plan()` itself and its legacy display path remain completely untouched for users who haven't activated the policy.

**Tech Stack:** TypeScript, Node native type stripping, `node:test`, React/`app/portfolio.tsx`.

**Spec:** `../../../reviews/CLAUDE-IMPLEMENTATION-BRIEF.md` (Milestone 2 → "AI role" subsection, and the parts of "Allocation and cash" about displaying before/after weights, costs, residual cash and exclusion reasons). Progress tracker: `docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md`.

## Global Constraints

- AI cannot set eligibility, bypass limits, invent evidence, or create trades (from `CLAUDE.md` — a standing, non-negotiable rule for this whole app, not new to this plan). The AI review's response schema (`{summary, profile}`) is unchanged — richer INPUT context, same OUTPUT contract, same `validateReview()` gate.
- "Retain legacy profile-import compatibility without allowing it to bypass new eligibility checks" — target weights (what the AI/import flow proposes) and monthly purchase eligibility (what `researchPlan()` gates) are different concepts; `researchPlan()` independently re-checks eligibility regardless of what target weights say, so this is already structurally satisfied by the existing architecture — verify this in Task 1, don't weaken `validateReview()`.
- "Adding a comparison candidate requires user approval and target editing" — comparison candidates appear only as prompt CONTEXT (text), never as an option in the `weights` JSON schema, which still only accepts existing target>0 shortlisted tickers.
- New policy settings must be previewable and explicitly activated — this plan does not change that; it only makes the ALREADY-explicit activation (2a) actually have a visible effect once flipped on.
- `plan()` and its existing display path remain byte-identical for any user who has not activated `researchPolicy` — this plan is purely additive from their point of view.
- oxlint: typeAware/typeCheck on, correctness treated as errors, no-explicit-any/no-deprecated/react-rules-of-hooks enforced.
- Per standing instruction this session: run the automated suite (`node --test`/`tsc`/lint/build) at every task. Task 4 of this plan is where the DEFERRED interactive browser check and the DEFERRED final whole-branch review both happen — covering all of 2b-i + 2b-ii + 2b-iii together, not just this sub-plan, since they were rolled up per that same standing instruction.

## Confirmed current-state facts (verified against the post-2b-ii codebase this session)

- `app/api/review/route.ts`: `tickers.length < 5 || tickers.length > 8` restriction still present, unchanged since Milestone 1. `plan()` is called once (`const currentPlan = plan(portfolio, month, 0, true)`) purely to build `compact.budget/remainingBudget/marketValue` for the AI's context. No reference anywhere to `researchPlan`/`assessAll`/`researchPolicy`.
- `app/portfolio.tsx`'s Monthly SIP tab: `calc = plan(p, month, fees, allowOld)` computed once near the top of the component (shared with other tabs' summary stats). The "Suggested purchase breakdown" table (`app/portfolio.tsx:1600-1641` as of this session — re-locate fresh) renders `calc.rows`, with columns `Company / Current → target / Price used / Whole shares / Estimated spend / Why` — the "Why" cell renders `r.reason` (a single string, `plan()`'s row shape). `calc.errors.length` gates whether shares/amounts show `—` instead of numbers. An "Available this month" summary panel (found via this session's earlier browser screenshot, exact location to re-confirm) shows budget/planned-purchases/leftover figures derived from `calc`.
- `ResearchPlanRow` (from 2b-ii) deliberately shares field names with `plan()`'s row shape where they overlap (`ticker, name, price, asOf, currentWeight, target, shares, amount`), differing only in `reason: string` (plan) vs `eligible: boolean; exclusionReasons: string[]` (researchPlan) — chosen specifically so the existing table's non-"Why" columns can render either row shape without a type-unification helper.
- No "Save plan" UI, no saved-plans list, no comparison-candidates concept anywhere in the app (confirmed by grep this session).

---

### Task 1: AI review route — remove the arbitrary company-count cap, supply assessments and comparison candidates

**Files:**
- Modify: `app/api/review/route.ts`

**Interfaces:**
- Consumes: `assessAll`, `researchPlan` from `@/lib/decision`.

- [ ] **Step 1: Read the current route fully**

Read the actual current `app/api/review/route.ts` in full (it's ~330 lines, already read multiple times this session but re-confirm current state — Milestone 1 added quote-fingerprint logic to this file, so it's not identical to the version originally surveyed).

- [ ] **Step 2: Remove the 5-8 restriction, replace with a minimal correctness guard**

Replace:
```typescript
    if (tickers.length < 5 || tickers.length > 8)
      throw Error(
        'Keep five to eight companies in the shortlist for an AI allocation review.',
      );
```
with:
```typescript
    if (tickers.length === 0)
      throw Error(
        'Add at least one shortlisted company (a positive target weight) before requesting an AI review.',
      );
```
(This is the only guard actually required for correctness — `equalWeights`' `Math.floor(10000 / tickers.length)` would divide by zero otherwise. The 5-8 range itself was never load-bearing for anything downstream; removing it doesn't change `validateReview`'s per-weight 0-20% cap or the 100%-sum requirement, which still bound how concentrated any profile can be regardless of shortlist size.)

- [ ] **Step 3: Swap `currentPlan`'s source when the research-driven policy is active**

Add the import:
```typescript
import { assessAll, researchPlan } from '@/lib/decision';
```

Replace:
```typescript
    const currentPlan = plan(portfolio, month, 0, true);
```
with:
```typescript
    const policy = portfolio.researchPolicy;
    const usingResearchPlan = policy?.enabled === true;
    const currentPlan = usingResearchPlan
      ? researchPlan(portfolio, policy, month, 0, today())
      : plan(portfolio, month, 0, true);
```
(`researchPlan`'s result carries the same `budget`/`remaining`/`total` field names `compact` already reads from `currentPlan` a few lines below — no further change needed there. `today` is already imported in this file for other purposes — confirm and reuse, don't re-import.)

- [ ] **Step 4: Add assessment and comparison-candidate context to the prompt, only when the policy is active**

Immediately before the `const response = await fetch(...)` call, add:

```typescript
    const assessmentContext = usingResearchPlan
      ? assessAll(portfolio, policy!, today())
          .filter((a) => tickers.includes(a.ticker))
          .map((a) =>
            a.eligible
              ? `${a.ticker}: eligible for a new research-driven contribution.`
              : `${a.ticker}: excluded — ${a.exclusionReasons.join(' ')}`,
          )
          .join('\n')
      : '';
    const comparisonCandidates = (portfolio.research ?? [])
      .filter((r) => !tickers.includes(r.ticker) && r.status === 'Complete')
      .slice(0, 10)
      .map(
        (r) =>
          `${r.ticker}: stance ${r.stance ?? 'Research incomplete'}, score ${r.score ?? 'unknown'}/100. Not in your current shortlist — for comparison only; adding it requires your explicit approval and a target weight, never automatic.`,
      )
      .join('\n');
```

Then extend the `input` field of the request body (find the existing `input:` string concatenation, which currently builds `'RESEARCH NOTES...' + researchContext(...) + '\nVALID TARGET PROFILES\n' + ...`) to insert, right after the `researchContext(...)` line and before `'\nVALID TARGET PROFILES\n'`:

```typescript
          (assessmentContext
            ? '\nRESEARCH-DRIVEN ELIGIBILITY (read-only; you cannot change these)\n' + assessmentContext
            : '') +
          (comparisonCandidates
            ? '\nRESEARCHED COMPANIES OUTSIDE YOUR SHORTLIST (comparison only — never include these in your weights JSON, which must use only existing shortlisted tickers)\n' + comparisonCandidates
            : '') +
```

(Read the exact current concatenation structure before editing — string-concatenation splice points are fragile; insert these two conditional blocks as new terms in the existing `+`-chain, don't restructure the whole expression.) Also append one sentence to the existing `instructions:` string (the long system-prompt string already present in this route) making the constraint explicit to the model: `" Companies listed under RESEARCH-DRIVEN ELIGIBILITY or RESEARCHED COMPANIES OUTSIDE YOUR SHORTLIST are context only — you must never propose weights for a company that is not already a shortlisted ticker, and eligibility exclusions are not yours to override."`

- [ ] **Step 5: Type-check and test**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (this route has no dedicated test harness, consistent with the rest of the app's `app/api/**/route.ts` files — this step only confirms nothing else broke).

- [ ] **Step 6: Commit**

```bash
git add app/api/review/route.ts
git commit -m "feat: supply research-driven eligibility and comparison candidates to the AI review, remove the 5-8 company cap"
```

---

### Task 2: Monthly SIP tab — wire `researchPlan()` into the suggested-purchase display

**Files:**
- Modify: `app/portfolio.tsx`

**Interfaces:**
- Consumes: `researchPlan`, `ResearchPlanResult` from `@/lib/decision`.

- [ ] **Step 1: Read the current Monthly SIP tab's plan-rows table and summary stats precisely**

Read the actual current `<TabsContent value="sip">` block in full, including: where `calc = plan(...)` is computed, the "Available this month" summary panel (budget/planned-purchases/cash-left-over stats — locate by searching for text matching what a browser screenshot earlier this session showed: "AVAILABLE THIS MONTH", "Planned purchases", "Cash left over"), and the "Suggested purchase breakdown" table (`calc.rows.map(...)`, columns `Company / Current → target / Price used / Whole shares / Estimated spend / Why`). Re-confirm exact current line numbers and JSX structure before editing — this file has changed substantially across this session's prior tasks.

- [ ] **Step 2: Compute `researchCalc` alongside the existing `calc`**

Near where `calc = plan(p, month, fees, allowOld)` is computed, add:

```typescript
const researchCalc = p.researchPolicy?.enabled
  ? researchPlan(p, p.researchPolicy, month, fees, today())
  : null;
```

Import `researchPlan` from `@/lib/decision` alongside this file's other imports.

- [ ] **Step 3: Switch the "Suggested purchase breakdown" table to `researchCalc` when active**

Replace the table body's row source from `calc.rows.map(...)` to `(researchCalc ?? calc).rows.map(...)`, and replace the errors-gate checks (`calc.errors.length ? '—' : ...`) with `((researchCalc ?? calc).errors.length ? '—' : ...)`. Replace the "Why" cell:

```tsx
<TableCell>
  {'reason' in r
    ? r.reason
    : r.eligible
      ? 'Eligible'
      : r.exclusionReasons.join(' ')}
</TableCell>
```

(`'reason' in r` is a safe runtime discriminant between `plan()`'s row shape and `ResearchPlanRow` — TypeScript narrows correctly on this check since the two row types are structurally distinguishable by this field's presence.)

Add a clear mode indicator directly above the table (inside the existing `<div className="section-top">` that currently holds the "Suggested purchase breakdown" heading and its "Automatically recalculates..." paragraph):

```tsx
{researchCalc && (
  <p className="tag status-complete">
    Research-driven policy active — eligibility, screening and sector
    limits now govern this list.
  </p>
)}
```

(Match the exact existing tag/badge CSS class already used elsewhere in this file for a similar "active state" indicator — search for `className="tag status-complete"` or equivalent and reuse whatever convention already exists, rather than inventing a new one; the class name shown here is illustrative, confirm against the file's real convention.)

- [ ] **Step 4: Update the "Available this month" summary panel**

Locate the summary panel's budget/planned-purchases/cash-left-over stats (built from `calc.remaining`/`calc.invested`/`calc.leftover` today). When `researchCalc` is present, show its `availableToSpend`/`confirmedFunds`/`invested`/`leftover` instead, with labels that distinguish the two figures (budget target vs. confirmed spendable amount) — e.g. add one more stat line: `Confirmed funds: {money(researchCalc.confirmedFunds)}` and change "Cash left over" to read from `researchCalc.leftover` when active. Read the exact current JSX for this panel before editing; it was not fully re-read in this planning session, so match its real structure rather than assuming.

- [ ] **Step 5: Type-check and verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS (no dedicated test for this UI file, consistent with the rest of the app).

- [ ] **Step 6: Commit**

```bash
git add app/portfolio.tsx
git commit -m "feat: show the research-driven plan in the Monthly SIP tab when the policy is active"
```

---

### Task 3: "Save plan" button and saved-plans list

**Files:**
- Modify: `app/portfolio.tsx`

**Interfaces:**
- Consumes: `saveResearchPlanSnapshot`, `SavedPlan` from `@/lib/decision`/`@/lib/portfolio`.

- [ ] **Step 1: Read the current file's save/attempt conventions once more**

Reuse the same `attempt`/`save`/`clone`/`busy` conventions already established and reviewed clean across this session's other `app/portfolio.tsx` tasks (2b-i's funding-entry manager, the dividend reinvestment action). Locate a sensible mount point — directly below Task 2's plan table, inside the same `<TabsContent value="sip">` block, is the natural place.

- [ ] **Step 2: Add the "Save plan" button**

```tsx
{researchCalc && researchCalc.errors.length === 0 && (
  <button
    disabled={busy}
    onClick={() =>
      attempt(async () => {
        const next = clone(p);
        const snapshot = saveResearchPlanSnapshot(
          researchCalc,
          p.researchPolicy!,
          month,
          fees,
          new Date().toISOString(),
        );
        next.savedPlans = [...(next.savedPlans ?? []), snapshot];
        await save(next, 'Plan saved. This snapshot will not change as prices or holdings move.');
      })
    }
  >
    Save this plan
  </button>
)}
```

Import `saveResearchPlanSnapshot` from `@/lib/decision` alongside this file's other imports.

- [ ] **Step 3: Add a read-only saved-plans list**

Below the button, render existing saved plans for context (most recent first):

```tsx
{(p.savedPlans ?? []).length > 0 && (
  <section className="panel">
    <p className="eyebrow">SAVED PLANS</p>
    <h3>Past snapshots, frozen at the time they were saved.</h3>
    <Table>
      <TableHeader>
        <TableRow>
          {['Saved', 'Month', 'Invested', 'Leftover', 'Companies'].map((x) => (
            <TableHead key={x}>{x}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...(p.savedPlans ?? [])]
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
          .map((sp) => (
            <TableRow key={sp.id}>
              <TableCell>{sp.savedAt.slice(0, 10)}</TableCell>
              <TableCell>{sp.month}</TableCell>
              <TableCell>{money(sp.invested)}</TableCell>
              <TableCell>{money(sp.leftover)}</TableCell>
              <TableCell>
                {sp.rows.filter((r) => r.shares > 0).length} funded ·{' '}
                {sp.rows.filter((r) => !r.eligible).length} excluded
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  </section>
)}
```

(No edit/delete action — saved plans are immutable by design, per the Global Constraint. Match `Table`/`TableRow`/`TableHead`/`TableBody`/`TableCell` to this file's real, already-established convention.)

- [ ] **Step 4: Type-check and verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/portfolio.tsx
git commit -m "feat: add a Save plan action and a read-only saved-plans list to the Monthly SIP tab"
```

---

### Task 4: Consolidated verification for all of Milestone 2b (2b-i + 2b-ii + 2b-iii)

**Files:**
- Modify: `docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md`

This is the deferred, consolidated checkpoint — per standing instruction this session, interactive browser verification and the final whole-branch review were rolled up from all three 2b sub-plans to run once, here.

- [ ] **Step 1: Full automated verification suite**

```bash
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Record exact pass/fail; cross-check any lint finding against `git log` before assuming pre-existing.

- [ ] **Step 2: Interactive browser check (real account, read-only unless explicitly instructed otherwise)**

Check for an existing dev server on port 3000 first. On the real local account:
1. Monthly SIP tab with the policy INACTIVE (its current real state) — confirm the tab looks and behaves exactly as before this whole milestone (no regression for the common case).
2. Open the policy preview (2a), read-only — confirm it still renders correctly post-2b-i/ii/iii changes.
3. If judged safe and explicitly reversible (read-only inspection only, do not actually click "Activate" against the real account without being asked) — visually confirm the Monthly SIP tab's new research-driven-mode elements (mode indicator, Save plan button, saved-plans section) render without crashing by temporarily reasoning about the code path rather than toggling real account state; if genuine interactive verification of the ACTIVE state is wanted, ask before flipping the real account's `researchPolicy.enabled`.
4. Purchase log / dividend list — confirm the "Mark as reinvested" button (2b-i) still renders correctly (regression check after this milestone's later changes).
5. Check browser console for new errors (the existing Grammarly-extension hydration warning is known-benign, already confirmed harmless earlier this session — don't re-flag it).

- [ ] **Step 3: Final whole-branch review (opus) for all of Milestone 2b**

Generate a review package for the FULL range `git merge-base main HEAD` (or, more precisely, the commit immediately before 2b-i's first task — the same BASE used when 2b-i's plan was dispatched) through the current HEAD, covering 2b-i + 2b-ii + 2b-iii together. Dispatch on the most capable available model, following the same process used for Milestone 1's and Milestone 2a's final whole-branch reviews (task-level reviews already happened for every task in all three sub-plans; this is the cross-cutting check for issues only visible when reviewing the whole span together — e.g., does `researchPlan`'s output actually reach the UI correctly end-to-end, does the AI route's `usingResearchPlan` branch actually get exercised when the policy is active, is there any remaining place that reads `plan()`'s output where `researchCalc` should now take precedence).

If the review returns findings, follow the standard one-fix-wave-then-scoped-re-review process (same as this session's prior final reviews).

- [ ] **Step 4: Update PROGRESS.md**

Check off Milestone 2b's items in full (2b-i, 2b-ii, 2b-iii, and the milestone-level final review outcome), note Milestone 3 is next.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md
git commit -m "docs: record Milestone 2b completion (2b-i+2b-ii+2b-iii), consolidated verification and final review results"
```

---

## Self-Review

**Spec coverage:**
- "Supply the validated assessments and calculated plan to AI for explanation" → Task 1.
- "Include reviewed companies outside the shortlist as comparison candidates, clearly distinguished from approved purchase candidates" → Task 1's `comparisonCandidates`, explicitly labeled and structurally unable to receive weights (unchanged `validateReview` ticker-membership check).
- "Remove the arbitrary five-to-eight-company restriction" → Task 1, replaced with the one guard that's actually load-bearing (divide-by-zero).
- "Retain legacy profile-import compatibility without allowing it to bypass new eligibility checks" → verified structurally satisfied (target weights and monthly eligibility are independent concepts; `researchPlan` re-checks eligibility regardless) rather than requiring new code — documented as a design note in Task 1 rather than an unnecessary new validation layer.
- "Show before/after weights, costs, residual cash and all exclusion reasons" → Task 2's table + summary panel wiring.
- "Capture immutable saved plan inputs/results when the user chooses Save plan" → Task 3 (the capture mechanism itself, `saveResearchPlanSnapshot`, was already built and reviewed clean in 2b-ii — this task is purely the UI trigger and display).
- Milestone-wide acceptance criteria from the brief ("no purchases for excluded companies; no overspending or duplicate carry-forward; projected limits enforced for new purchases; pause stays effective; AI failure leaves the deterministic plan usable; saved plans remain unchanged") — all already satisfied by 2b-i/2b-ii's already-reviewed-clean logic; this plan's job is making that logic reachable and visible, not re-verifying it (Task 4's consolidated review is the place to confirm the wiring didn't introduce a NEW gap in any of these).

**Placeholder scan:** every step has literal code where the design is settled; Task 2 Steps 3-4 and Task 3 explicitly flag needing a fresh read of the file's current exact JSX (this file has changed substantially across the session, and pre-committing to exact stale line numbers would be worse than directing a fresh read) — this is the same, already-successful pattern used for 2b-i's Task 3/4 and 2a's Task 5/6, not a logic placeholder.

**Type consistency:** `researchCalc`'s type (`ResearchPlanResult | null`) is used identically across Tasks 2 and 3. `ResearchPlanRow`'s discriminating field (`'reason' in r`) is the same check introduced once in Task 2 and not redefined elsewhere.
