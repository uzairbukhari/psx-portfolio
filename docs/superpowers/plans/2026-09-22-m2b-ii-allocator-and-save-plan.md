# Milestone 2b-ii — Research-driven allocator and save-plan snapshot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, sector-aware allocation function (`researchPlan`) that uses `assessCompany`'s eligibility instead of the existing target/screenDate rule, bounded by both remaining budget and confirmed funds (2b-i), recalculating shared sector headroom as whole shares are assigned, never suggesting a forced sale, never renormalizing eligible companies to absorb 100% of spend. Plus an immutable "save plan" snapshot capture function. **No UI in this plan** — that's 2b-iii, once the allocator's output has a place to be displayed. This plan is calculation-only, reviewable in isolation.

**Architecture:** `researchPlan()` lives in `lib/decision.ts` (not `lib/portfolio.ts`) — it calls `assessAll`, which already lives there and already imports `Portfolio`/`holdings`/`round` one-directionally from `lib/portfolio.ts`. Putting the allocator in `lib/portfolio.ts` instead would require `lib/portfolio.ts` to import `assessAll` back from `lib/decision.ts`, creating a circular import; keeping the dependency one-directional (`lib/decision.ts` → `lib/portfolio.ts`, never the reverse) is why this plan's new function lives where it does. `SavedPlan` (a `Portfolio` field) lives in `lib/portfolio.ts` for the same reason `ResearchPolicy` does — a `Portfolio.savedPlans?` field needs its type available without `lib/portfolio.ts` importing `lib/decision.ts`.

**Tech Stack:** TypeScript, Node native type stripping, `node:test`.

**Spec:** `../../../reviews/CLAUDE-IMPLEMENTATION-BRIEF.md` (Milestone 2 → "Allocation and cash" subsection). Regression fixtures 1, 4, 8. Progress tracker: `docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md`.

## Global Constraints

- Preserve long-term target weights separately from this month's allocations — never renormalize eligible companies to absorb 100% of `availableToSpend` when some are excluded; unspent cash stays unallocated (`leftover`).
- Never suggest a sale. An overweight company or sector simply gets `gap: 0` — clamped at zero, never negative, never a sell instruction.
- Exposure uses share market value (`holdings()`'s existing `value` field); spending includes fees (the existing `Math.ceil(price*(1+feePct/100)*100)/100` fee-inclusive unit-cost convention from `plan()`).
- Available planned spend is bounded by BOTH remaining budget AND remaining confirmed funds (2b-i's `confirmedFunds`) — `availableToSpend = min(remaining, remainingConfirmedFunds)`.
- Deterministic tie-breaking for whole-share leftovers (same convention `plan()` already uses and has tests for: greedy loop sorted by `gap-amount` descending).
- A saved plan's captured inputs/results must never be silently rewritten by later market changes — `saveResearchPlanSnapshot` freezes a plain data snapshot, no live references.
- oxlint: typeAware/typeCheck on, correctness treated as errors, no-explicit-any/no-deprecated enforced.
- Per explicit user instruction this session: run the automated suite (`node --test`/`tsc`/lint/build) at every task and at this plan's wrap-up, but skip the interactive browser walkthrough — that's deferred to one consolidated pass after 2b-iii lands. Do not skip a per-task subagent code review; only the manual browser check is deferred.

## Confirmed current-state facts (verified against the post-2b-i codebase this session)

- `plan()` (`lib/portfolio.ts:732-830` as of this session — re-locate fresh, since 2b-i's `confirmedFunds` addition shifted lines above it): eligibility `approved && screenDate<=today && daysSince<=183`; cap `Math.min(target,20)/100 * post` where `post = total + remaining`; two-pass proportional-then-greedy whole-share allocation, greedy loop bounded at 10000 iterations, tie-broken by `b.gap-b.amount` descending. Return shape `{budget, already, remaining, total, invested, leftover, errors, stale, rows}`, each row `{ticker, name, price, asOf, currentWeight, target, gap, shares, amount, reason}`. `plan()` itself is **not modified by this plan** — it remains the target-only fallback for when the research-driven policy isn't active (2b-iii decides when to call which).
- `lib/decision.ts` (post-2a): `assessCompany(p, policy, ticker, today): CompanyAssessment`, `assessAll(p, policy, today): CompanyAssessment[]`. `CompanyAssessment.effectiveQuote: {price, date} | null`, `.eligible: boolean`, `.exclusionReasons: string[]`. Imports only from `./portfolio.ts`.
- `lib/portfolio.ts` (post-2b-i): `confirmedFunds(p, month): number`, placed immediately before `plan()`. Sums non-voided `FundingEntry`s for the given month.
- `Company.sector: Sector | ''` — an unclassified sector is a real, common state on the real account; `assessCompany` already treats it as a hard eligibility block, so `researchPlan`'s rows for such a company will already show `eligible: false` via `assessAll` — the allocator does not need its own separate unclassified-sector handling beyond what `assessCompany` already provides.
- No `SavedPlan`/`savedPlans` concept exists anywhere (confirmed by grep this session).

---

### Task 1: `researchPlan()` — the sector-aware allocator

**Files:**
- Modify: `lib/decision.ts` (new type, new function)
- Test: `tests/decision.test.mjs`

**Interfaces:**
- Consumes: `assessAll` (already in this file), `Portfolio`, `ResearchPolicy`, `holdings`, `round`, `confirmedFunds` from `./portfolio` (add `confirmedFunds` to the existing import list from that module).
- Produces: `export type ResearchPlanRow = { ticker: string; name: string; price: number | null; asOf: string; currentWeight: number; target: number; eligible: boolean; exclusionReasons: string[]; gap: number; shares: number; amount: number }`, `export type ResearchPlanResult = { budget: number; already: number; remaining: number; confirmedFunds: number; availableToSpend: number; total: number; invested: number; leftover: number; errors: string[]; stale: string[]; rows: ResearchPlanRow[] }`, `export function researchPlan(p: Portfolio, policy: ResearchPolicy, month: string, feePct: number, todayDate: string): ResearchPlanResult` (2b-iii, not this plan, will call this by this exact name and signature).

- [ ] **Step 1: Write failing tests**

```javascript
// append to tests/decision.test.mjs
import { researchPlan } from '../lib/decision.ts';
import { round } from '../lib/portfolio.ts';

test('a single eligible company gets shares up to its target gap, bounded by availableToSpend', () => {
  const p = basePortfolio();
  p.budgets = { [date.slice(0, 7)]: 100000 };
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  const row = r.rows.find((x) => x.ticker === 'TEST');
  assert.equal(row.eligible, true);
  assert.ok(row.shares > 0);
  assert.equal(r.errors.length, 0);
});

test('fixture 1: five Watchlist companies at 20% target, priced at 2x fair value, allocate zero with reasons', () => {
  const p = { companies: [], trades: [], quotes: {}, budgets: { [date.slice(0, 7)]: 500000 }, research: [] };
  for (const ticker of ['A', 'B', 'C', 'D', 'E']) {
    p.companies.push({ ticker, name: ticker, sector: 'Bank', target: 20, approved: true, screenDate: date, note: '', screening: { source: 'x', status: 'Pass', effectiveDate: date, reviewDueDate: date }, approvedMaxPrice: 1000, approvedResearchVersion: 1 });
    p.quotes[ticker] = { price: 200, date, asOf: date, source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt: new Date().toISOString() };
    p.research.push({ ticker, status: 'Complete', score: 50, fairValue: 100, fairValueLow: 80, fairValueHigh: 120, valuationProvenance: 'scenario-model', stance: 'Watchlist', researchRevision: 1, thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: date });
  }
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  for (const row of r.rows) {
    assert.equal(row.eligible, false);
    assert.equal(row.shares, 0);
    assert.ok(row.exclusionReasons.some((x) => /not Consider/i.test(x)));
  }
  assert.equal(r.invested, 0);
});

test('fixture 4: an overweight holding and an overweight sector receive no new contribution, no sell suggested', () => {
  const p = basePortfolio();
  p.trades = [{ id: 'op', ticker: 'TEST', kind: 'opening', date, shares: 1000, price: null, fees: 0, month: '', note: '' }];
  p.companies[0].target = 5;
  p.budgets = { [date.slice(0, 7)]: 100000 };
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  const row = r.rows.find((x) => x.ticker === 'TEST');
  assert.equal(row.gap, 0);
  assert.equal(row.shares, 0);
  assert.ok(!r.rows.some((x) => x.shares < 0));
});

test('fixture 8: multiple eligible companies in one sector, expensive shares, fees, small budget, deterministic ties, no cap breach, no negative residual', () => {
  const p = { companies: [], trades: [], quotes: {}, budgets: { [date.slice(0, 7)]: 5000 }, research: [] };
  for (const ticker of ['A', 'B', 'C']) {
    p.companies.push({ ticker, name: ticker, sector: 'Bank', target: 33.34, approved: true, screenDate: date, note: '', screening: { source: 'x', status: 'Pass', effectiveDate: date, reviewDueDate: date }, approvedMaxPrice: 5000, approvedResearchVersion: 1 });
    p.quotes[ticker] = { price: 1200, date, asOf: date, source: `https://dps.psx.com.pk/company/${ticker}`, fetchedAt: new Date().toISOString() };
    p.research.push({ ticker, status: 'Complete', score: 90, fairValue: 1500, fairValueLow: 1300, fairValueHigh: 1700, valuationProvenance: 'scenario-model', stance: 'Consider', researchRevision: 1, thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: date });
  }
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 1.5, date);
  assert.ok(r.invested <= 5000);
  assert.ok(r.leftover >= 0);
  assert.equal(round(r.invested + r.leftover), round(r.availableToSpend));
  for (const row of r.rows) assert.ok(Number.isInteger(row.shares));
  // Run twice with identical inputs — deterministic tie-breaking means identical output.
  const r2 = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 1.5, date);
  assert.deepEqual(r.rows.map((x) => x.shares), r2.rows.map((x) => x.shares));
});

test('availableToSpend is bounded by the lesser of remaining budget and remaining confirmed funds', () => {
  const p = basePortfolio();
  p.budgets = { [date.slice(0, 7)]: 100000 };
  p.funding = [{ id: 'f1', month: date.slice(0, 7), source: 'manual', amount: 150, note: '', createdAt: new Date().toISOString() }];
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  assert.equal(r.confirmedFunds, 150);
  assert.equal(r.availableToSpend, 150);
  assert.ok(r.invested <= 150);
});

test('target weights not summing to 100% blocks allocation with an error, same as plan()', () => {
  const p = basePortfolio();
  p.companies[0].target = 50;
  p.budgets = { [date.slice(0, 7)]: 100000 };
  const r = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  assert.ok(r.errors.some((e) => /100%/.test(e)));
  assert.equal(r.invested, 0);
});
```

(`basePortfolio`/`date`/`DEFAULT_RESEARCH_POLICY` are already defined/imported at the top of `tests/decision.test.mjs` from prior tasks — reuse them; add `researchPlan` and `round` to the existing import lines from `../lib/decision.ts`/`../lib/portfolio.ts` rather than re-importing.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/decision.test.mjs`
Expected: FAIL — `researchPlan` is not exported.

- [ ] **Step 3: Implement**

Add `confirmedFunds` to `lib/decision.ts`'s existing import from `./portfolio`:

```typescript
import {
  holdings,
  round,
  confirmedFunds,
  type Portfolio,
  type ResearchPolicy,
  type Screening,
} from './portfolio';
```

Append to `lib/decision.ts`:

```typescript
export type ResearchPlanRow = {
  ticker: string;
  name: string;
  price: number | null;
  asOf: string;
  currentWeight: number;
  target: number;
  eligible: boolean;
  exclusionReasons: string[];
  gap: number;
  shares: number;
  amount: number;
};

export type ResearchPlanResult = {
  budget: number;
  already: number;
  remaining: number;
  confirmedFunds: number;
  availableToSpend: number;
  total: number;
  invested: number;
  leftover: number;
  errors: string[];
  stale: string[];
  rows: ResearchPlanRow[];
};

export function researchPlan(
  p: Portfolio,
  policy: ResearchPolicy,
  month: string,
  feePct: number,
  todayDate: string,
): ResearchPlanResult {
  const hs = holdings(p);
  const budget = p.budgets[month] ?? 100000;
  const already = round(
    p.trades
      .filter((t) => !t.voided && t.kind === 'buy' && t.month === month)
      .reduce((a, t) => a + t.shares * t.price! + t.fees, 0),
  );
  const remaining = Math.max(0, round(budget - already));
  const funds = confirmedFunds(p, month);
  const remainingFunds = Math.max(0, round(funds - already));
  const availableToSpend = Math.min(remaining, remainingFunds);

  const candidates = hs.filter((h) => h.target > 0);
  const totalTarget = candidates.reduce((a, h) => a + h.target, 0);
  const errors: string[] = [];
  if (Math.abs(totalTarget - 100) > 0.01)
    errors.push('Target weights must total 100%.');
  if (!Number.isFinite(feePct) || feePct < 0 || feePct > 10)
    errors.push('Fee estimate must be between 0% and 10%.');

  const total = hs.reduce((a, h) => a + (h.value ?? 0), 0);
  const post = total + availableToSpend;

  const assessments = new Map(
    assessAll(p, policy, todayDate).map((a) => [a.ticker, a]),
  );

  const sectorTotals = new Map<string, number>();
  for (const h of hs)
    if (h.sector)
      sectorTotals.set(h.sector, (sectorTotals.get(h.sector) ?? 0) + (h.value ?? 0));

  const stale = candidates
    .filter((h) => h.quote && h.quote.date !== todayDate)
    .map((h) => h.ticker);

  const rows: ResearchPlanRow[] = candidates.map((h) => {
    const a = assessments.get(h.ticker)!;
    const companyCap = (Math.min(h.target, policy.companyCapPct) / 100) * post;
    const companyGap = Math.max(0, companyCap - (h.value ?? 0));
    const sectorCap = (policy.sectorCapPct / 100) * post;
    const sectorRemaining = h.sector
      ? Math.max(0, sectorCap - (sectorTotals.get(h.sector) ?? 0))
      : 0;
    const gap = a.eligible ? Math.min(companyGap, sectorRemaining) : 0;
    return {
      ticker: h.ticker,
      name: h.name,
      price: a.effectiveQuote?.price ?? null,
      asOf: h.quote?.asOf ?? '',
      currentWeight: total ? ((h.value ?? 0) / total) * 100 : 0,
      target: h.target,
      eligible: a.eligible,
      exclusionReasons: a.exclusionReasons,
      gap,
      shares: 0,
      amount: 0,
    };
  });

  if (!errors.length && availableToSpend > 0) {
    let cash = availableToSpend;
    const active = rows.filter((r) => r.eligible && r.gap > 0);
    const gapsTotal = active.reduce((a, r) => a + r.gap, 0);
    for (const r of active) {
      const price = r.price!;
      const unit = Math.ceil(price * (1 + feePct / 100) * 100) / 100;
      const allocation = Math.min(
        r.gap,
        gapsTotal ? (availableToSpend * r.gap) / gapsTotal : 0,
      );
      r.shares = Math.floor(allocation / unit);
      r.amount = round(r.shares * unit);
      cash = round(cash - r.amount);
      const h = hs.find((x) => x.ticker === r.ticker)!;
      if (h.sector)
        sectorTotals.set(h.sector, (sectorTotals.get(h.sector) ?? 0) + r.amount);
    }
    for (let i = 0; i < 10000; i++) {
      const sectorCap = (policy.sectorCapPct / 100) * post;
      const next = active
        .filter((r) => {
          const price = r.price!;
          const u = Math.ceil(price * (1 + feePct / 100) * 100) / 100;
          if (u > cash || r.amount + u > r.gap) return false;
          const h = hs.find((x) => x.ticker === r.ticker)!;
          if (h.sector) {
            const sectorUsed = sectorTotals.get(h.sector) ?? 0;
            if (sectorUsed + u > sectorCap) return false;
          }
          return true;
        })
        .sort((a, b) => b.gap - b.amount - (a.gap - a.amount))[0];
      if (!next) break;
      const h = hs.find((x) => x.ticker === next.ticker)!;
      const price = next.price!;
      const unit = Math.ceil(price * (1 + feePct / 100) * 100) / 100;
      next.shares++;
      next.amount = round(next.amount + unit);
      cash = round(cash - unit);
      if (h.sector)
        sectorTotals.set(h.sector, (sectorTotals.get(h.sector) ?? 0) + unit);
    }
  }

  const invested = round(rows.reduce((a, r) => a + r.amount, 0));
  return {
    budget,
    already,
    remaining,
    confirmedFunds: funds,
    availableToSpend,
    total,
    invested,
    leftover: round(availableToSpend - invested),
    errors,
    stale,
    rows,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/decision.test.mjs`
Expected: PASS, all tests including the 6 new ones.

Run: `node --test 'tests/*.test.mjs'`
Expected: PASS, full suite.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/decision.ts tests/decision.test.mjs
git commit -m "feat: add researchPlan, a sector-aware allocator driven by assessCompany eligibility"
```

---

### Task 2: `SavedPlan` type and persistence

**Files:**
- Modify: `lib/portfolio.ts` (new type, `Portfolio` type, `validate`)
- Test: `tests/portfolio.test.mjs`

**Interfaces:**
- Produces: `export type SavedPlanRow = { ticker: string; name: string; price: number | null; shares: number; amount: number; eligible: boolean; exclusionReasons: string[] }`, `export type SavedPlan = { id: string; month: string; savedAt: string; policySnapshot: ResearchPolicy; budget: number; confirmedFunds: number; feePct: number; invested: number; leftover: number; rows: SavedPlanRow[] }`, `Portfolio.savedPlans?: SavedPlan[]` (Task 3 of this plan produces these; 2b-iii's UI, not this plan, will read them for display).

- [ ] **Step 1: Write failing tests**

```javascript
// append to tests/portfolio.test.mjs
const savedPlanRow = (over = {}) => ({ ticker: 'TEST', name: 'Test', price: 20, shares: 5, amount: 100, eligible: true, exclusionReasons: [], ...over });
const savedPlan = (over = {}) => ({
  id: crypto.randomUUID(), month, savedAt: new Date().toISOString(),
  policySnapshot: DEFAULT_RESEARCH_POLICY, budget: 10000, confirmedFunds: 5000,
  feePct: 0.5, invested: 100, leftover: 4900, rows: [savedPlanRow()], ...over,
});
test('validate accepts a well-formed saved plan and rejects a malformed one',()=>{
  const p=fresh();
  p.savedPlans=[savedPlan()];
  validate(p);
  p.savedPlans=[savedPlan({month:'2026-13'})];
  assert.throws(()=>validate(p));
  p.savedPlans=[savedPlan({rows:[savedPlanRow({shares:-1})]})];
  assert.throws(()=>validate(p));
  p.savedPlans=[savedPlan({invested:-5})];
  assert.throws(()=>validate(p));
});
test('validate accepts an empty savedPlans array and treats the field as fully optional',()=>{
  const p=fresh();
  validate(p);
  p.savedPlans=[];
  validate(p);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/portfolio.test.mjs`
Expected: FAIL — `savedPlans` not recognized.

- [ ] **Step 3: Implement**

Add near `ResearchPolicy`/`DEFAULT_RESEARCH_POLICY` in `lib/portfolio.ts`:

```typescript
export type SavedPlanRow = {
  ticker: string;
  name: string;
  price: number | null;
  shares: number;
  amount: number;
  eligible: boolean;
  exclusionReasons: string[];
};
export type SavedPlan = {
  id: string;
  month: string;
  savedAt: string;
  policySnapshot: ResearchPolicy;
  budget: number;
  confirmedFunds: number;
  feePct: number;
  invested: number;
  leftover: number;
  rows: SavedPlanRow[];
};
```

Extend `Portfolio` (add `savedPlans?: SavedPlan[];`).

In `validate()`, add a block after the `researchPolicy` block:

```typescript
  if (p.savedPlans !== undefined) {
    if (!Array.isArray(p.savedPlans) || p.savedPlans.length > 2000)
      throw Error('Portfolio exceeds supported size.');
    const planIds = new Set<string>();
    for (const sp of p.savedPlans) {
      if (
        typeof sp.id !== 'string' ||
        planIds.has(sp.id) ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ||
        typeof sp.savedAt !== 'string' ||
        !Number.isFinite(sp.budget) ||
        sp.budget < 0 ||
        !Number.isFinite(sp.confirmedFunds) ||
        sp.confirmedFunds < 0 ||
        !Number.isFinite(sp.feePct) ||
        sp.feePct < 0 ||
        sp.feePct > 10 ||
        !Number.isFinite(sp.invested) ||
        sp.invested < 0 ||
        !Number.isFinite(sp.leftover) ||
        sp.leftover < 0 ||
        !Array.isArray(sp.rows) ||
        sp.rows.length > 200
      )
        throw Error('Invalid saved plan.');
      for (const row of sp.rows) {
        if (
          typeof row.ticker !== 'string' ||
          typeof row.name !== 'string' ||
          (row.price !== null && !Number.isFinite(row.price)) ||
          !Number.isInteger(row.shares) ||
          row.shares < 0 ||
          !Number.isFinite(row.amount) ||
          row.amount < 0 ||
          typeof row.eligible !== 'boolean' ||
          !Array.isArray(row.exclusionReasons)
        )
          throw Error('Invalid saved plan row.');
      }
      planIds.add(sp.id);
    }
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/portfolio.test.mjs`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio.ts tests/portfolio.test.mjs
git commit -m "feat: add SavedPlan type for immutable point-in-time plan snapshots"
```

---

### Task 3: `saveResearchPlanSnapshot` — the capture function

**Files:**
- Modify: `lib/decision.ts`
- Test: `tests/decision.test.mjs`

**Interfaces:**
- Consumes: `researchPlan`, `ResearchPlanResult` (Task 1), `SavedPlan`, `SavedPlanRow` (Task 2, imported from `./portfolio`).
- Produces: `export function saveResearchPlanSnapshot(result: ResearchPlanResult, policy: ResearchPolicy, month: string, feePct: number, savedAt: string): SavedPlan` (2b-iii's "Save plan" button, not this plan, will call this by this exact name).

- [ ] **Step 1: Write failing tests**

```javascript
// append to tests/decision.test.mjs
import { saveResearchPlanSnapshot } from '../lib/decision.ts';

test('saveResearchPlanSnapshot freezes a plain, independent copy of the plan result', () => {
  const p = basePortfolio();
  p.budgets = { [date.slice(0, 7)]: 100000 };
  const result = researchPlan(p, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, date);
  const snap = saveResearchPlanSnapshot(result, DEFAULT_RESEARCH_POLICY, date.slice(0, 7), 0, new Date().toISOString());
  assert.equal(snap.month, date.slice(0, 7));
  assert.equal(snap.invested, result.invested);
  assert.equal(snap.rows.length, result.rows.length);
  assert.deepEqual(snap.policySnapshot, DEFAULT_RESEARCH_POLICY);
  // Mutating the original result must not affect the already-captured snapshot.
  result.rows[0].shares = 999999;
  assert.notEqual(snap.rows[0].shares, 999999);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/decision.test.mjs`
Expected: FAIL — `saveResearchPlanSnapshot` not exported.

- [ ] **Step 3: Implement**

Add `SavedPlan`, `SavedPlanRow` to `lib/decision.ts`'s existing import from `./portfolio`, and append:

```typescript
export function saveResearchPlanSnapshot(
  result: ResearchPlanResult,
  policy: ResearchPolicy,
  month: string,
  feePct: number,
  savedAt: string,
): SavedPlan {
  return {
    id: crypto.randomUUID(),
    month,
    savedAt,
    policySnapshot: { ...policy },
    budget: result.budget,
    confirmedFunds: result.confirmedFunds,
    feePct,
    invested: result.invested,
    leftover: result.leftover,
    rows: result.rows.map((r) => ({
      ticker: r.ticker,
      name: r.name,
      price: r.price,
      shares: r.shares,
      amount: r.amount,
      eligible: r.eligible,
      exclusionReasons: [...r.exclusionReasons],
    })),
  };
}
```

(`crypto.randomUUID()` is a global in the Cloudflare Workers/browser/Node runtimes this codebase already targets — no import needed, matching the existing convention in `app/portfolio.tsx`'s `record()`/`recordDividend()`.)

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/decision.test.mjs`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/decision.ts tests/decision.test.mjs
git commit -m "feat: add saveResearchPlanSnapshot to freeze an immutable point-in-time plan"
```

---

### Task 4: Verification sweep and PROGRESS update

**Files:**
- Modify: `docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md`

- [ ] **Step 1: Full automated verification suite**

```bash
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Record exact pass/fail; cross-check any lint finding against `git log` before assuming pre-existing, matching prior milestones' convention. Per this session's standing instruction, no interactive browser check this task — that's deferred to the consolidated pass after 2b-iii.

- [ ] **Step 2: Update PROGRESS.md**

Check off 2b-ii's items, note 2b-iii (AI role + Monthly SIP UI wiring, including the "Save plan" button and a saved-plans view) is next and depends on `researchPlan`/`saveResearchPlanSnapshot`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md
git commit -m "docs: record Milestone 2b-ii completion and verification results"
```

---

## Self-Review

**Spec coverage:**
- "Allocate by positive target gaps, bounded by company and sector headroom and fee-inclusive affordability" → Task 1's `researchPlan`.
- "Recalculate shared sector headroom as quantities are assigned" → the running `sectorTotals` map, updated after every share assignment in both the proportional and greedy passes.
- "Use deterministic tie-breaking for whole-share leftovers" → same sort convention `plan()` already uses; Task 1's fixture-8 test explicitly asserts determinism by running twice.
- "Do not force eligible companies to absorb 100%... unspent cash stays unallocated" → `leftover` field, never renormalized.
- "Keep already overweight positions; new contributions must not worsen a breached company/sector allocation. Do not suggest forced sales" → `Math.max(0, cap - current)` clamping at both the company and sector level; fixture 4's test.
- "Separate planned monthly budget from confirmed available funds... limited by both" → `availableToSpend = min(remaining, remainingFunds)`.
- "Capture immutable saved plan inputs/results" → Tasks 2-3.
- Fixtures 1, 4, 8 → Task 1's dedicated tests. Fixture 9 already covered in 2b-i.
- UI (Save plan button, saved-plans display, wiring `researchPlan` into the Monthly SIP tab) is explicitly **not** in this plan — that's 2b-iii.

**Placeholder scan:** every step has literal, complete code.

**Type consistency:** `ResearchPlanResult`/`ResearchPlanRow`/`SavedPlan`/`SavedPlanRow` names and shapes are identical across Tasks 1-3. `researchPlan`'s signature `(p, policy, month, feePct, todayDate)` and `saveResearchPlanSnapshot`'s signature `(result, policy, month, feePct, savedAt)` are what 2b-iii will need to match exactly.
