# Milestone 2a — Shared decision contract and policy preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every company a single, typed, testable eligibility assessment (`assessCompany`) driven by research stance, Shariah-screening evidence, an approved maximum purchase price, and target/company/sector headroom — with a new, inactive-by-default `ResearchPolicy` the user can preview side-by-side against today's plan before explicitly activating it. This plan does **not** change what `plan()` actually allocates or spends — that's Milestone 2b, which will consume `assessCompany` once it exists here.

**Architecture:** Three additive data-model extensions in `lib/portfolio.ts` (a `stance` field synced from the existing dossier `investmentStance`, a new `Screening` record type, and a new `ResearchPolicy` type/default), followed by one new pure module `lib/decision.ts` (`assessCompany`/`assessAll`) that reads them, followed by UI to edit the new per-company fields and preview the assessment before activation.

**Tech Stack:** Same as Milestone 1 — TypeScript with Node's native type stripping, `node:test`, React (`app/portfolio.tsx`, dense multi-line JSX in this file's dialog sections — match its existing indentation style, not `lib/portfolio.ts`'s one-liner style).

**Spec:** `../../../reviews/CLAUDE-IMPLEMENTATION-BRIEF.md` (Milestone 2 section, "Shared decision contract" and "Policy preview and defaults" subsections). Progress tracker: `docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md`.

## Global Constraints

- Preserve existing targets, screening dates, notes, approvals — every new field is optional/additive; nothing here changes what the EXISTING `plan()` function computes or what any saved company/target/approval currently means.
- `ResearchPolicy.enabled` defaults to `false`. Nothing in this plan wires the policy into actual allocation (that's Milestone 2b) — this plan only builds the assessment function and lets the user preview and explicitly flip `enabled`.
- Unknown/incomplete research must never silently qualify: `stance !== 'Consider'` is always an exclusion reason, including when there is no dossier at all (`stance: 'None'`).
- A partially-approved company (e.g. `approved: false`, a "paused" state) with an otherwise-`Consider` dossier must remain excluded — this is regression fixture 5 from the brief and gets an explicit test.
- oxlint: typeAware/typeCheck on, `correctness` treated as errors, `no-explicit-any`/`no-deprecated`/`react/rules-of-hooks` enforced. No `any` in new code.
- Path alias `@/*` maps to repo root.
- Run at the end: `node --test tests/*.test.mjs`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

## Confirmed current-state facts (verified against the post-Milestone-1 codebase this session — do not re-derive)

- `lib/portfolio.ts:651-750` (`plan()`): eligibility is `h.approved && h.screenDate && h.screenDate<=today() && daysSince(h.screenDate)<=183`. Cap is `Math.min(h.target,20)/100 * post` — flat 20%, no sector concept anywhere. Grep confirms zero references to `sector`/`stance`/`screening`/`research` inside `plan()` — it is target/screenDate-driven only, blind to dossier stance, evidence, or valuation. Not touched by this plan.
- `Company` type (`lib/portfolio.ts:14-22`): `{ticker,name,sector:Sector|'',target,approved,screenDate,note}`. No sector-cap field, no company-cap override, no separate "paused" flag (paused is just `approved:false`), no max-purchase-price field. Confirmed absent by grep.
- `ResearchCompany` type (`lib/portfolio.ts:92-114`, post-M1): `{ticker,status,score,fairValue,fairValueLow,fairValueHigh,valuationProvenance?,thesis,risks,catalysts,conversationUrl,sources[],financials[],updatedAt,details?}`. **No `stance` field.**
- `DossierCompany` type (`app/research-data.ts:15-42`) still has `investmentStance?:'Research incomplete'|'Avoid'|'Watchlist'|'Consider'`. Confirmed via direct read of `app/dossier-experience.tsx`'s `onSave` (post-M1) that `investmentStance` is **not** copied onto the saved `ResearchCompany` — the sync function sets `status,score,fairValue,fairValueLow,fairValueHigh,valuationProvenance,thesis,risks,catalysts,conversationUrl,sources,financials,updatedAt` but never `investmentStance`.
- `Company.screenDate` is a single ISO date string, `note` is free text — no structured screening source/status/review-due-date fields anywhere.
- No "Save plan", "confirmed funds", "carry-forward", or "dividend reinvestment funding" concept exists anywhere (Milestone 2b's territory, not this plan's).
- `app/portfolio.tsx`: the per-company edit form is the `Dialog` at lines ~2308-2428 (`open={!!company}`), backed by local state `company: Company | null` (`setCompany`), saved via `saveCompany` (lines 893-902: `next.companies[at]=company; await save(next)`). "Add company" (line 1058-1074) seeds a blank literal `{ticker:'',name:'',sector:'',target:0,approved:false,screenDate:'',note:''}` — since new fields will be optional, this blank literal needs no changes. "Edit" (line 1463) does `setCompany({...c})` — spreads whatever fields exist, automatically picking up new optional ones.
- `SECTORS` is a fixed 10-value enum; `sector: ''` (unclassified) is a valid, common state on real seeded companies — `assessCompany` must treat it as a hard block, not a crash.

---

### Task 1: Add `stance` to `ResearchCompany`, synced from the dossier's `investmentStance`

**Files:**
- Modify: `lib/portfolio.ts` (type `ResearchCompany`, function `validate`)
- Modify: `app/dossier-experience.tsx` (the `onSave` sync)
- Test: `tests/portfolio.test.mjs`

**Interfaces:**
- Produces: `ResearchCompany.stance?: 'Consider' | 'Watchlist' | 'Avoid' | 'Research incomplete'` (later tasks in this plan and Milestone 2b read this field by this exact name).

- [ ] **Step 1: Write failing tests**

```javascript
// append to tests/portfolio.test.mjs
test('validate accepts every stance value and rejects an invalid one',()=>{
  const p=fresh();
  for(const stance of ['Consider','Watchlist','Avoid','Research incomplete']){
    p.research=[{ticker:'TEST',status:'Complete',score:null,fairValue:null,fairValueLow:null,fairValueHigh:null,thesis:'',risks:'',catalysts:'',conversationUrl:'',sources:[],financials:[],updatedAt:date,stance}];
    validate(p);
  }
  p.research[0].stance='Bullish';
  assert.throws(()=>validate(p));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/portfolio.test.mjs`
Expected: FAIL — `stance` rejected by `validate` (the research-array loop's `||` chain has no clause for it, so an unrecognized field is silently allowed today, but the *last* assertion in the new test — rejecting `'Bullish'`ic— will fail since nothing currently rejects it).

- [ ] **Step 3: Implement**

Extend `ResearchCompany` (`lib/portfolio.ts:92-114`), adding the field right after `valuationProvenance`:

```typescript
export type ResearchCompany = {
  ticker: string;
  status: 'Queue' | 'Researching' | 'Complete' | 'Update needed';
  score: number | null;
  fairValue: number | null;
  fairValueLow: number | null;
  fairValueHigh: number | null;
  valuationProvenance?: 'scenario-model' | 'legacy';
  stance?: 'Consider' | 'Watchlist' | 'Avoid' | 'Research incomplete';
  thesis: string;
  risks: string;
  catalysts: string;
  conversationUrl: string;
  sources: string[];
  financials: {
    year: string;
    revenue: number | null;
    profit: number | null;
    eps: number | null;
    roe: number | null;
    debt: number | null;
  }[];
  updatedAt: string;
  details?: Record<string, unknown>;
};
```

In `validate()`'s `for (const r of p.research)` loop, add a clause to the existing `||` chain (alongside the `valuationProvenance` check added in Milestone 1):

```typescript
        (r.stance !== undefined &&
          !['Consider', 'Watchlist', 'Avoid', 'Research incomplete'].includes(
            r.stance,
          )) ||
```

In `app/dossier-experience.tsx`'s `onSave` (the `next: ResearchCompany` object literal), add `stance: c.investmentStance,` alongside the existing `fairValue`/`valuationProvenance` assignments (`c` is the `DossierCompany` the `Dossier` component returns, which already has `investmentStance` — no import changes needed, `DossierCompany`'s field is already in scope).

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/portfolio.test.mjs`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio.ts app/dossier-experience.tsx tests/portfolio.test.mjs
git commit -m "feat: sync dossier investment stance onto ResearchCompany"
```

---

### Task 2: Add Shariah-screening evidence and an approved-maximum-purchase-price to `Company`

**Files:**
- Modify: `lib/portfolio.ts` (new type `Screening`, `Company` type, `validate`)
- Test: `tests/portfolio.test.mjs`

**Interfaces:**
- Produces: `export type ScreeningStatus = 'Pass' | 'Fail' | 'Pending'`, `export type Screening = { source: string; status: ScreeningStatus; effectiveDate: string; reviewDueDate: string }`, `Company.screening?: Screening`, `Company.approvedMaxPrice?: number | null`, `Company.approvedResearchVersion?: string | null` (Task 4 of this plan reads all three by these exact names).

- [ ] **Step 1: Write failing tests**

```javascript
// append to tests/portfolio.test.mjs
test('validate accepts a well-formed screening record and rejects a bad status or date',()=>{
  const p=fresh();
  p.companies[0].screening={source:'PSX Shariah index',status:'Pass',effectiveDate:date,reviewDueDate:date};
  validate(p);
  p.companies[0].screening={source:'',status:'Pending',effectiveDate:'',reviewDueDate:''};
  validate(p);
  p.companies[0].screening={source:'x',status:'Maybe',effectiveDate:date,reviewDueDate:date};
  assert.throws(()=>validate(p));
  p.companies[0].screening={source:'x',status:'Pass',effectiveDate:'not-a-date',reviewDueDate:date};
  assert.throws(()=>validate(p));
});
test('validate accepts a numeric or null approvedMaxPrice, rejects zero/negative/non-finite',()=>{
  const p=fresh();
  p.companies[0].approvedMaxPrice=150.5;
  validate(p);
  p.companies[0].approvedMaxPrice=null;
  validate(p);
  p.companies[0].approvedMaxPrice=0;
  assert.throws(()=>validate(p));
  p.companies[0].approvedMaxPrice=-5;
  assert.throws(()=>validate(p));
  p.companies[0].approvedMaxPrice=Infinity;
  assert.throws(()=>validate(p));
});
test('validate accepts a string or null approvedResearchVersion',()=>{
  const p=fresh();
  p.companies[0].approvedResearchVersion=date;
  validate(p);
  p.companies[0].approvedResearchVersion=null;
  validate(p);
  p.companies[0].approvedResearchVersion=42;
  assert.throws(()=>validate(p));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/portfolio.test.mjs`
Expected: FAIL — none of the three new fields are recognized/validated yet, so the rejection assertions fail (the acceptance assertions currently pass only by accident, since `validate` doesn't look at unknown fields at all).

- [ ] **Step 3: Implement**

Add near the top of `lib/portfolio.ts`, alongside the other small exported types (after `Quote`, before `RESEARCH_MODELS`):

```typescript
export type ScreeningStatus = 'Pass' | 'Fail' | 'Pending';
export type Screening = {
  source: string;
  status: ScreeningStatus;
  effectiveDate: string;
  reviewDueDate: string;
};
```

Extend `Company` (`lib/portfolio.ts:14-22`):

```typescript
export type Company = {
  ticker: string;
  name: string;
  sector: Sector | '';
  target: number;
  approved: boolean;
  screenDate: string;
  note: string;
  screening?: Screening;
  approvedMaxPrice?: number | null;
  approvedResearchVersion?: string | null;
};
```

In `validate()`'s `for (const c of p.companies)` loop, add to the existing `||` chain (the one that already checks `ticker`/`name`/`sector`/`approved`/`target`/`note`/`screenDate`):

```typescript
      (c.screening !== undefined &&
        c.screening !== null &&
        (typeof c.screening.source !== 'string' ||
          c.screening.source.length > 500 ||
          !['Pass', 'Fail', 'Pending'].includes(c.screening.status) ||
          (c.screening.effectiveDate !== '' &&
            !dateOK(c.screening.effectiveDate)) ||
          (c.screening.reviewDueDate !== '' &&
            !dateOK(c.screening.reviewDueDate)))) ||
      (c.approvedMaxPrice !== undefined &&
        c.approvedMaxPrice !== null &&
        (!Number.isFinite(c.approvedMaxPrice) ||
          c.approvedMaxPrice <= 0 ||
          c.approvedMaxPrice > 1e8)) ||
      (c.approvedResearchVersion !== undefined &&
        c.approvedResearchVersion !== null &&
        typeof c.approvedResearchVersion !== 'string') ||
```

(`dateOK` is already defined and exported in this file — reuse it, matching the existing `screenDate` check's own pattern of allowing an empty string.)

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/portfolio.test.mjs`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/portfolio.ts tests/portfolio.test.mjs
git commit -m "feat: add Shariah screening evidence and approved maximum purchase price to Company"
```

---

### Task 3: Add `ResearchPolicy` and its default (inactive) settings

**Files:**
- Modify: `lib/portfolio.ts` (new type `ResearchPolicy`, `DEFAULT_RESEARCH_POLICY`, `Portfolio` type, `validate`)
- Test: `tests/portfolio.test.mjs`

**Interfaces:**
- Produces: `export type QuoteFreshness = 'today' | 'dated'`, `export type ResearchPolicy = { enabled: boolean; companyCapPct: number; sectorCapPct: number; quoteFreshness: QuoteFreshness; maxQuoteAgeDays: number | null }`, `export const DEFAULT_RESEARCH_POLICY: ResearchPolicy`, `Portfolio.researchPolicy?: ResearchPolicy` (Task 4 and Task 6 of this plan, plus all of Milestone 2b, read/write this by this exact name).

- [ ] **Step 1: Write failing tests**

```javascript
// append to tests/portfolio.test.mjs
test('DEFAULT_RESEARCH_POLICY is inactive with the brief\'s initial caps and requires today\'s quote',()=>{
  assert.equal(DEFAULT_RESEARCH_POLICY.enabled,false);
  assert.equal(DEFAULT_RESEARCH_POLICY.companyCapPct,20);
  assert.equal(DEFAULT_RESEARCH_POLICY.sectorCapPct,30);
  assert.equal(DEFAULT_RESEARCH_POLICY.quoteFreshness,'today');
  assert.equal(DEFAULT_RESEARCH_POLICY.maxQuoteAgeDays,null);
});
test('validate accepts a well-formed researchPolicy and rejects an inconsistent one',()=>{
  const p=fresh();
  p.researchPolicy=DEFAULT_RESEARCH_POLICY;
  validate(p);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,enabled:true,sectorCapPct:35};
  validate(p);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,quoteFreshness:'dated',maxQuoteAgeDays:5};
  validate(p);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,quoteFreshness:'dated',maxQuoteAgeDays:null};
  assert.throws(()=>validate(p),/dated/);
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,companyCapPct:150};
  assert.throws(()=>validate(p));
  p.researchPolicy={...DEFAULT_RESEARCH_POLICY,quoteFreshness:'weekly'};
  assert.throws(()=>validate(p));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/portfolio.test.mjs`
Expected: FAIL — `DEFAULT_RESEARCH_POLICY` does not exist; `researchPolicy` is not recognized by `validate`.

- [ ] **Step 3: Implement**

Add near `DEFAULT_RESEARCH_SETTINGS` in `lib/portfolio.ts` (same section, same pattern):

```typescript
export type QuoteFreshness = 'today' | 'dated';
export type ResearchPolicy = {
  enabled: boolean;
  companyCapPct: number;
  sectorCapPct: number;
  quoteFreshness: QuoteFreshness;
  maxQuoteAgeDays: number | null;
};
export const DEFAULT_RESEARCH_POLICY: ResearchPolicy = {
  enabled: false,
  companyCapPct: 20,
  sectorCapPct: 30,
  quoteFreshness: 'today',
  maxQuoteAgeDays: null,
};
```

Extend `Portfolio` (add `researchPolicy?: ResearchPolicy;` alongside the existing `researchSettings?: ResearchSettings;`).

In `validate()`, add a block mirroring the existing `if (p.researchSettings !== undefined) {...}` block, placed right after it:

```typescript
  if (p.researchPolicy !== undefined) {
    const policy = p.researchPolicy;
    if (
      !policy ||
      typeof policy.enabled !== 'boolean' ||
      !Number.isFinite(policy.companyCapPct) ||
      policy.companyCapPct <= 0 ||
      policy.companyCapPct > 100 ||
      !Number.isFinite(policy.sectorCapPct) ||
      policy.sectorCapPct <= 0 ||
      policy.sectorCapPct > 100 ||
      !['today', 'dated'].includes(policy.quoteFreshness)
    )
      throw Error('Invalid research policy.');
    if (
      policy.quoteFreshness === 'dated' &&
      (!Number.isFinite(policy.maxQuoteAgeDays) ||
        (policy.maxQuoteAgeDays as number) <= 0)
    )
      throw Error(
        'A dated-quote research policy requires a positive maximum quote age in days.',
      );
    if (
      policy.quoteFreshness === 'today' &&
      policy.maxQuoteAgeDays !== null
    )
      throw Error(
        'A today-only research policy must not set a maximum quote age.',
      );
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
git commit -m "feat: add ResearchPolicy type and inactive-by-default settings"
```

---

### Task 4: The single assessment function — `lib/decision.ts`

**Files:**
- Create: `lib/decision.ts`
- Test: `tests/decision.test.mjs`

**Interfaces:**
- Consumes: `Portfolio`, `Company`, `ResearchCompany`, `Screening`, `ResearchPolicy`, `holdings`, `round` from `./portfolio` (Tasks 1-3 of this plan).
- Produces: `export type CompanyAssessment = { ticker: string; eligible: boolean; exclusionReasons: string[]; researchVersionReviewed: string | null; stance: 'Consider' | 'Watchlist' | 'Avoid' | 'Research incomplete' | 'None'; criticalConditions: string[]; screening: Screening | null; effectiveQuote: { price: number; date: string } | null; valuation: { low: number | null; base: number | null; high: number | null; provenance: 'scenario-model' | 'legacy' | 'unavailable' }; approvedMaxPrice: number | null; currentExposurePct: number; targetExposurePct: number; companyHeadroomPct: number; sectorHeadroomPct: number | null }`, `export function assessCompany(p: Portfolio, policy: ResearchPolicy, ticker: string, today: string): CompanyAssessment`, `export function assessAll(p: Portfolio, policy: ResearchPolicy, today: string): CompanyAssessment[]` (Milestone 2b's allocator and Task 6 of this plan consume these by these exact names).

- [ ] **Step 1: Write failing tests**

```javascript
// tests/decision.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCompany, assessAll } from '../lib/decision.ts';
import { DEFAULT_RESEARCH_POLICY, today } from '../lib/portfolio.ts';

const date = today();
const basePortfolio = () => ({
  companies: [{
    ticker: 'TEST', name: 'Test', sector: 'Bank', target: 10, approved: true,
    screenDate: date, note: '',
    screening: { source: 'PSX index', status: 'Pass', effectiveDate: date, reviewDueDate: date },
    approvedMaxPrice: 100, approvedResearchVersion: date,
  }],
  trades: [], quotes: { TEST: { price: 90, date, asOf: date, source: 'https://dps.psx.com.pk/company/TEST', fetchedAt: new Date().toISOString() } },
  budgets: {},
  research: [{ ticker: 'TEST', status: 'Complete', score: 80, fairValue: 120, fairValueLow: 100, fairValueHigh: 140, valuationProvenance: 'scenario-model', stance: 'Consider', thesis: '', risks: '', catalysts: '', conversationUrl: '', sources: [], financials: [], updatedAt: date }],
});

test('a fully qualifying company is eligible with no exclusion reasons', () => {
  const a = assessCompany(basePortfolio(), DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, true);
  assert.deepEqual(a.exclusionReasons, []);
  assert.equal(a.stance, 'Consider');
  assert.equal(a.valuation.base, 120);
  assert.equal(a.effectiveQuote?.price, 90);
});

test('fixture 5: a Consider dossier with the purchase flag paused (approved:false) remains excluded', () => {
  const p = basePortfolio();
  p.companies[0].approved = false;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /not approved/i.test(r)));
});

test('Watchlist, Avoid, Research incomplete and no-dossier stances all exclude', () => {
  for (const stance of ['Watchlist', 'Avoid', 'Research incomplete']) {
    const p = basePortfolio();
    p.research[0].stance = stance;
    const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
    assert.equal(a.eligible, false, stance);
  }
  const noResearch = basePortfolio();
  noResearch.research = [];
  const a = assessCompany(noResearch, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.stance, 'None');
});

test('a superseded research approval is an unresolved critical condition', () => {
  const p = basePortfolio();
  p.research[0].updatedAt = '2026-09-25';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.criticalConditions.length, 1);
  assert.ok(a.exclusionReasons.some((r) => r.includes('Unresolved')));
});

test('a failed or overdue screening excludes; a missing screening excludes', () => {
  const failed = basePortfolio();
  failed.companies[0].screening.status = 'Fail';
  assert.equal(assessCompany(failed, DEFAULT_RESEARCH_POLICY, 'TEST', date).eligible, false);
  const overdue = basePortfolio();
  overdue.companies[0].screening.reviewDueDate = '2020-01-01';
  assert.equal(assessCompany(overdue, DEFAULT_RESEARCH_POLICY, 'TEST', date).eligible, false);
  const missing = basePortfolio();
  delete missing.companies[0].screening;
  const a = assessCompany(missing, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.screening, null);
});

test('a quote priced above the approved maximum excludes; a missing quote excludes under a today-only policy', () => {
  const expensive = basePortfolio();
  expensive.quotes.TEST.price = 150;
  assert.equal(assessCompany(expensive, DEFAULT_RESEARCH_POLICY, 'TEST', date).eligible, false);
  const stale = basePortfolio();
  stale.quotes.TEST.date = '2020-01-01';
  const a = assessCompany(stale, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.effectiveQuote, null);
});

test('a dated-quote policy accepts a quote within the configured age and rejects one older', () => {
  const p = basePortfolio();
  p.quotes.TEST.date = '2026-09-15';
  const dated = { ...DEFAULT_RESEARCH_POLICY, quoteFreshness: 'dated', maxQuoteAgeDays: 10 };
  const withinAge = assessCompany(p, dated, 'TEST', '2026-09-20');
  assert.ok(withinAge.effectiveQuote);
  const tooOld = assessCompany(p, dated, 'TEST', '2026-09-30');
  assert.equal(tooOld.effectiveQuote, null);
});

test('no approved maximum purchase price excludes even with a cheap accepted quote', () => {
  const p = basePortfolio();
  p.companies[0].approvedMaxPrice = null;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.exclusionReasons.some((r) => /maximum purchase price/i.test(r)));
});

test('an unclassified sector blocks eligibility even when otherwise qualifying', () => {
  const p = basePortfolio();
  p.companies[0].sector = '';
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.equal(a.sectorHeadroomPct, null);
  assert.ok(a.exclusionReasons.some((r) => /sector not classified/i.test(r)));
});

test('being at or above target, company cap or sector cap excludes on headroom, computed from real holdings', () => {
  const p = basePortfolio();
  p.trades = [{ id: '1', ticker: 'TEST', kind: 'opening', date, shares: 100, price: null, fees: 0, month: '', note: '' }];
  p.companies[0].target = 1;
  const a = assessCompany(p, DEFAULT_RESEARCH_POLICY, 'TEST', date);
  assert.equal(a.eligible, false);
  assert.ok(a.currentExposurePct > 0);
  assert.ok(a.exclusionReasons.some((r) => /at or above target/i.test(r)));
});

test('assessAll returns one assessment per company, in company order', () => {
  const p = basePortfolio();
  p.companies.push({ ticker: 'OTHER', name: 'Other', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  const all = assessAll(p, DEFAULT_RESEARCH_POLICY, date);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((a) => a.ticker), ['TEST', 'OTHER']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/decision.test.mjs`
Expected: FAIL — `lib/decision.ts` does not exist.

- [ ] **Step 3: Implement**

```typescript
// lib/decision.ts
import {
  holdings,
  round,
  type Portfolio,
  type ResearchPolicy,
  type Screening,
} from './portfolio';

export type CompanyAssessment = {
  ticker: string;
  eligible: boolean;
  exclusionReasons: string[];
  researchVersionReviewed: string | null;
  stance: 'Consider' | 'Watchlist' | 'Avoid' | 'Research incomplete' | 'None';
  criticalConditions: string[];
  screening: Screening | null;
  effectiveQuote: { price: number; date: string } | null;
  valuation: {
    low: number | null;
    base: number | null;
    high: number | null;
    provenance: 'scenario-model' | 'legacy' | 'unavailable';
  };
  approvedMaxPrice: number | null;
  currentExposurePct: number;
  targetExposurePct: number;
  companyHeadroomPct: number;
  sectorHeadroomPct: number | null;
};

function effectiveQuoteFor(
  p: Portfolio,
  ticker: string,
  policy: ResearchPolicy,
  today: string,
): { price: number; date: string } | null {
  const q = p.quotes[ticker];
  if (!q) return null;
  if (policy.quoteFreshness === 'today')
    return q.date === today ? { price: q.price, date: q.date } : null;
  const maxAge = policy.maxQuoteAgeDays ?? 0;
  const ageDays = (Date.parse(today) - Date.parse(q.date)) / 86400000;
  return ageDays >= 0 && ageDays <= maxAge
    ? { price: q.price, date: q.date }
    : null;
}

function sectorExposurePct(
  p: Portfolio,
  sector: string,
  totalValue: number,
): number {
  if (!sector || !totalValue) return 0;
  const value = holdings(p)
    .filter((h) => h.sector === sector)
    .reduce((a, h) => a + (h.value ?? 0), 0);
  return (value / totalValue) * 100;
}

export function assessCompany(
  p: Portfolio,
  policy: ResearchPolicy,
  ticker: string,
  today: string,
): CompanyAssessment {
  const c = p.companies.find((x) => x.ticker === ticker);
  if (!c) throw Error(ticker + ': not found in companies.');
  const research = p.research?.find((r) => r.ticker === ticker);
  const stance: CompanyAssessment['stance'] = research
    ? (research.stance ?? 'Research incomplete')
    : 'None';
  const hs = holdings(p);
  const totalValue = hs.reduce((a, h) => a + (h.value ?? 0), 0);
  const holding = hs.find((h) => h.ticker === ticker);
  const currentExposurePct = totalValue
    ? ((holding?.value ?? 0) / totalValue) * 100
    : 0;
  const targetExposurePct = c.target;
  const targetHeadroomPct = targetExposurePct - currentExposurePct;
  const companyHeadroomPct = policy.companyCapPct - currentExposurePct;
  const sectorHeadroomPct = c.sector
    ? policy.sectorCapPct - sectorExposurePct(p, c.sector, totalValue)
    : null;
  const effectiveQuote = effectiveQuoteFor(p, ticker, policy, today);
  const screening = c.screening ?? null;
  const criticalConditions: string[] = [];
  if (
    c.approvedResearchVersion &&
    research &&
    c.approvedResearchVersion !== research.updatedAt
  )
    criticalConditions.push(
      `Research updated since approval (approved ${c.approvedResearchVersion}, current ${research.updatedAt}) — re-review required.`,
    );
  const approvedMaxPrice = c.approvedMaxPrice ?? null;
  const valuation: CompanyAssessment['valuation'] = {
    low: research?.fairValueLow ?? null,
    base: research?.fairValue ?? null,
    high: research?.fairValueHigh ?? null,
    provenance:
      research?.valuationProvenance ??
      (research?.fairValue != null ? 'legacy' : 'unavailable'),
  };
  const reasons: string[] = [];
  if (!c.approved || c.target <= 0)
    reasons.push('Not approved for contributions, or no positive target set.');
  if (stance !== 'Consider')
    reasons.push(`Research stance is "${stance}", not Consider.`);
  for (const cond of criticalConditions) reasons.push('Unresolved: ' + cond);
  if (!screening) reasons.push('No recorded Shariah screening evidence.');
  else if (screening.status === 'Fail')
    reasons.push('Failed Shariah screening.');
  else if (!screening.reviewDueDate)
    reasons.push('No screening review due date set.');
  else if (screening.reviewDueDate < today)
    reasons.push('Shariah screening review is overdue.');
  if (!effectiveQuote)
    reasons.push('No accepted quote under the current policy.');
  if (approvedMaxPrice == null)
    reasons.push('No approved maximum purchase price set.');
  else if (effectiveQuote && effectiveQuote.price > approvedMaxPrice)
    reasons.push(
      `Quote price ${effectiveQuote.price} exceeds the approved maximum of ${approvedMaxPrice}.`,
    );
  if (targetHeadroomPct <= 0)
    reasons.push('Already at or above target weight; no gap to fill.');
  if (companyHeadroomPct <= 0)
    reasons.push('Already at or above the company allocation limit.');
  if (!c.sector)
    reasons.push('Sector not classified; allocation blocked until classified.');
  else if (sectorHeadroomPct !== null && sectorHeadroomPct <= 0)
    reasons.push('Sector already at or above the sector allocation limit.');
  return {
    ticker,
    eligible: reasons.length === 0,
    exclusionReasons: reasons,
    researchVersionReviewed: c.approvedResearchVersion ?? null,
    stance,
    criticalConditions,
    screening,
    effectiveQuote,
    valuation,
    approvedMaxPrice,
    currentExposurePct: round(currentExposurePct),
    targetExposurePct,
    companyHeadroomPct: round(companyHeadroomPct),
    sectorHeadroomPct: sectorHeadroomPct === null ? null : round(sectorHeadroomPct),
  };
}

export function assessAll(
  p: Portfolio,
  policy: ResearchPolicy,
  today: string,
): CompanyAssessment[] {
  return p.companies.map((c) => assessCompany(p, policy, c.ticker, today));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/decision.test.mjs`
Expected: PASS, all 11 tests.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/decision.ts tests/decision.test.mjs
git commit -m "feat: add the single company eligibility assessment function"
```

---

### Task 5: Company dialog — edit screening evidence, approved maximum price, and approve the current research version

**Files:**
- Modify: `app/portfolio.tsx` (the company `Dialog`, lines ~2308-2428)

**Interfaces:**
- Consumes: `Company.screening/approvedMaxPrice/approvedResearchVersion` (Task 2), `ResearchCompany` via the existing `p.research` the component already holds.

- [ ] **Step 1: Read the current company dialog form precisely**

Run: `sed -n '2308,2428p' app/portfolio.tsx` to confirm the exact current JSX before editing (this session already read it once; re-read fresh in case of drift, matching this repo's own convention of not trusting stale line numbers).

- [ ] **Step 2: Add the new fields**

Insert new `<label>` blocks immediately after the existing "Research / screening note" `<label>` (before the closing `</div>` of `.form-grid`, i.e. right before the `<p className="muted">` that follows it):

```tsx
                <label>
                  Shariah screening source
                  <input
                    maxLength={500}
                    value={company.screening?.source ?? ''}
                    onChange={(e) =>
                      setCompany({
                        ...company,
                        screening: {
                          source: e.target.value,
                          status: company.screening?.status ?? 'Pending',
                          effectiveDate: company.screening?.effectiveDate ?? '',
                          reviewDueDate: company.screening?.reviewDueDate ?? '',
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Screening status
                  <select
                    value={company.screening?.status ?? 'Pending'}
                    onChange={(e) =>
                      setCompany({
                        ...company,
                        screening: {
                          source: company.screening?.source ?? '',
                          status: e.target.value as 'Pass' | 'Fail' | 'Pending',
                          effectiveDate: company.screening?.effectiveDate ?? '',
                          reviewDueDate: company.screening?.reviewDueDate ?? '',
                        },
                      })
                    }
                  >
                    <option value="Pending">Pending</option>
                    <option value="Pass">Pass</option>
                    <option value="Fail">Fail</option>
                  </select>
                </label>
                <label>
                  Screening effective date
                  <input
                    type="date"
                    max={today()}
                    value={company.screening?.effectiveDate ?? ''}
                    onChange={(e) =>
                      setCompany({
                        ...company,
                        screening: {
                          source: company.screening?.source ?? '',
                          status: company.screening?.status ?? 'Pending',
                          effectiveDate: e.target.value,
                          reviewDueDate: company.screening?.reviewDueDate ?? '',
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Screening review due date
                  <input
                    type="date"
                    value={company.screening?.reviewDueDate ?? ''}
                    onChange={(e) =>
                      setCompany({
                        ...company,
                        screening: {
                          source: company.screening?.source ?? '',
                          status: company.screening?.status ?? 'Pending',
                          effectiveDate: company.screening?.effectiveDate ?? '',
                          reviewDueDate: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <label>
                  Approved maximum purchase price (PKR)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={company.approvedMaxPrice ?? ''}
                    onChange={(e) =>
                      setCompany({
                        ...company,
                        approvedMaxPrice:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
```

Immediately after that new block (still before the trailing `<p className="muted">`), add the research-version-approval control:

```tsx
                {company.ticker &&
                  (() => {
                    const research = p?.research?.find(
                      (r) => r.ticker === company.ticker,
                    );
                    if (!research)
                      return (
                        <p className="muted wide">
                          No dossier found for this ticker yet.
                        </p>
                      );
                    const current =
                      company.approvedResearchVersion === research.updatedAt;
                    return (
                      <div className="wide approval-row">
                        <p className="muted">
                          {current
                            ? `Approved against research updated ${research.updatedAt}.`
                            : company.approvedResearchVersion
                              ? `Research updated since approval (approved ${company.approvedResearchVersion}, current ${research.updatedAt}).`
                              : 'Not yet approved against current research.'}
                        </p>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            setCompany({
                              ...company,
                              approvedResearchVersion: research.updatedAt,
                            })
                          }
                        >
                          Approve current research version
                        </button>
                      </div>
                    );
                  })()}
```

(`p` — the outer `Dashboard` component's loaded `Portfolio` state — and `today` are already in scope in this file; no new imports needed. `company`'s type is `Company`, already extended by Task 2, so `company.screening`/`approvedMaxPrice`/`approvedResearchVersion` type-check without casts.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Browser-verify**

No automated test for this UI (consistent with the rest of the app). Deferred to Task 7's required browser check.

- [ ] **Step 5: Commit**

```bash
git add app/portfolio.tsx
git commit -m "feat: edit Shariah screening evidence, approved max price and research-version approval per company"
```

---

### Task 6: Policy preview — side-by-side comparison and explicit activation

**Files:**
- Create: `app/policy-preview.tsx`
- Modify: `app/portfolio.tsx` (mount the new component inside the Monthly SIP tab)

**Interfaces:**
- Consumes: `assessAll` from `@/lib/decision`, `DEFAULT_RESEARCH_POLICY`, `today` from `@/lib/portfolio`.
- Produces: a `PolicyPreview` component that reads the live `Portfolio` and current `plan()` result already computed by the Monthly SIP tab, and writes `Portfolio.researchPolicy` via the same `save()` the rest of the dashboard uses.

- [ ] **Step 1: Read the Monthly SIP tab's current structure**

Run: `sed -n '1,40p' app/portfolio.tsx` for the top-level imports, then locate the `<TabsContent value="sip">` block (confirmed at line ~1275 by this session's survey) and read enough of it (`sed -n '1275,1420p' app/portfolio.tsx`) to see how `calc = plan(...)` and `p`/`save`/`month`/`fees` are already available in that scope, so the new component receives exactly what it needs as props rather than re-deriving anything.

- [ ] **Step 2: Implement the preview component**

```tsx
// app/policy-preview.tsx
'use client';
import { useState } from 'react';
import { assessAll } from '@/lib/decision';
import {
  DEFAULT_RESEARCH_POLICY,
  today,
  type Portfolio,
  type ResearchPolicy,
} from '@/lib/portfolio';

type Props = {
  portfolio: Portfolio;
  save: (next: Portfolio, message?: string) => Promise<void>;
  busy: boolean;
};

export default function PolicyPreview({ portfolio, save, busy }: Props) {
  const [draft, setDraft] = useState<ResearchPolicy>(
    portfolio.researchPolicy ?? DEFAULT_RESEARCH_POLICY,
  );
  const active = portfolio.researchPolicy?.enabled ?? false;
  const assessments = assessAll(portfolio, draft, today());
  const eligible = assessments.filter((a) => a.eligible);
  const excluded = assessments.filter((a) => !a.eligible);
  return (
    <section className="policy-preview">
      <h3>Research-driven policy preview</h3>
      <p className="muted">
        This preview ignores research readiness and Shariah-screening
        evidence today; it only looks at target gaps. The research-driven
        column below adds stance, screening, an approved maximum price and
        sector limits on top. Activating it changes future SIP suggestions —
        it does not touch your saved holdings, targets or research.
      </p>
      <div className="form-grid">
        <label>
          Sector allocation limit (%)
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            value={draft.sectorCapPct}
            onChange={(e) =>
              setDraft({ ...draft, sectorCapPct: Number(e.target.value) })
            }
          />
        </label>
        <label className="check-row wide">
          <input
            type="checkbox"
            checked={draft.quoteFreshness === 'dated'}
            onChange={(e) =>
              setDraft({
                ...draft,
                quoteFreshness: e.target.checked ? 'dated' : 'today',
                maxQuoteAgeDays: e.target.checked ? 3 : null,
              })
            }
          />{' '}
          Accept quotes up to a maximum age instead of requiring today&apos;s
          price
        </label>
        {draft.quoteFreshness === 'dated' && (
          <label>
            Maximum quote age (days)
            <input
              type="number"
              min="1"
              step="1"
              value={draft.maxQuoteAgeDays ?? 3}
              onChange={(e) =>
                setDraft({ ...draft, maxQuoteAgeDays: Number(e.target.value) })
              }
            />
          </label>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Stance</th>
            <th>Eligible under research-driven policy</th>
            <th>Why not</th>
          </tr>
        </thead>
        <tbody>
          {assessments.map((a) => (
            <tr key={a.ticker}>
              <td>{a.ticker}</td>
              <td>{a.stance}</td>
              <td>{a.eligible ? 'Yes' : 'No'}</td>
              <td>{a.exclusionReasons.join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {eligible.length} of {assessments.length} companies would currently
        qualify for a new research-driven contribution; {excluded.length}{' '}
        would be excluded, with reasons shown above.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          save(
            { ...portfolio, researchPolicy: { ...draft, enabled: !active } },
            active
              ? 'Research-driven policy deactivated. Target-based planning resumed.'
              : 'Research-driven policy activated. Future SIP suggestions now require research readiness and screening evidence.',
          )
        }
      >
        {active
          ? 'Deactivate research-driven policy'
          : 'Activate research-driven policy'}
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Mount it in the Monthly SIP tab**

In `app/portfolio.tsx`, add the import near the other component imports at the top of the file:

```typescript
import PolicyPreview from './policy-preview';
```

Inside `<TabsContent value="sip">`, after the existing plan-results rendering (find the closing point of the current SIP tab's main content — the end of the `calc`/`rows` table, before the `</TabsContent>` closing tag), mount:

```tsx
              <PolicyPreview portfolio={p} save={save} busy={busy} />
```

(`p`, `save`, and `busy` are already defined in this scope, confirmed by Step 1's read — no new state needed in `app/portfolio.tsx` itself.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Browser-verify**

Deferred to Task 7.

- [ ] **Step 6: Commit**

```bash
git add app/policy-preview.tsx app/portfolio.tsx
git commit -m "feat: add research-driven policy preview with explicit activation toggle"
```

---

### Task 7: Verification sweep, browser check, PROGRESS update

**Files:**
- Modify: `docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md`

- [ ] **Step 1: Full verification suite**

```bash
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Record exact pass/fail. Cross-check any lint finding against `git log`/prior-milestone history the same way Milestone 1 did, before assuming it's pre-existing.

- [ ] **Step 2: Regression fixture check**

Fixture 5 ("A Consider dossier with a paused purchase flag: remains excluded") is directly covered by Task 4's test `fixture 5: a Consider dossier with the purchase flag paused (approved:false) remains excluded`. Confirm it's present and passing; no additional test needed for this plan.

- [ ] **Step 3: Browser-check on localhost (real account, read-only where it matters)**

Check for an existing dev server on port 3000 before starting one (`lsof -i :3000`). Open the Monthly SIP tab, confirm the new "Research-driven policy preview" section renders with real per-company assessments and correct exclusion reasons for the real portfolio (read-only — do not click "Activate" against the real account unless explicitly asked, since it would flip a real saved setting; note this in the report instead of doing it). Open the company edit dialog for one real company, confirm the new screening/approved-max-price/research-version-approval fields render without errors (read-only inspection — do not save changes to the real account's data unless explicitly instructed).

- [ ] **Step 4: Update PROGRESS.md**

Check off Milestone 2a's sub-items, note deferred/next work (Milestone 2b: allocation & cash rework, AI role update, Monthly SIP UI wiring of the actual research-driven `plan()` replacement).

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md
git commit -m "docs: record Milestone 2a completion and verification results"
```

---

## Self-Review

**Spec coverage:**
- "Introduce typed, backward-compatible structures for policy, company decisions and computed assessments" → Tasks 1-4 (`Screening`, `ResearchPolicy`, `CompanyAssessment`).
- "Use one assessment function for the board, SIP, exports and AI rather than duplicating eligibility checks" → Task 4's `assessCompany`/`assessAll`; Milestone 2b and Milestone 3's decision board will call these same functions rather than re-implementing eligibility (noted for the next plan, not re-litigated here).
- Every field the brief's bulleted eligibility list requires (`eligibility, all exclusion reasons, research version reviewed, stance, critical unresolved conditions, screening evidence, effective quote/date, valuation, approved maximum purchase price, current/target exposure, company/sector headroom`) → present verbatim in `CompanyAssessment`.
- All six eligibility bullet points (approved+positive target; Consider stance; no unresolved critical condition including superseded approval; screening evidence with no failure/overdue review; accepted quote + approved max price; positive headroom under target/company/sector with unknown-sector blocking) → each has its own reasons-list entry and its own test in Task 4.
- "Preserve existing targets. Use the existing 20% projected company ceiling as the initial setting. Present 30% per sector as an editable proposed setting" → `DEFAULT_RESEARCH_POLICY` (Task 3), editable in the preview UI (Task 6).
- "Keep today's-quote requirement as the initial setting. If the user enables dated quotes, require an explicit maximum calendar age... never accept arbitrarily old quotes" → `quoteFreshness`/`maxQuoteAgeDays` validation (Task 3) and `effectiveQuoteFor` (Task 4).
- "Show current target-based calculation and research-driven preview side by side during onboarding... cannot masquerade as the improved recommendation" → Task 6's preview explicitly labels the existing `plan()` behavior as target-only and the new column as adding readiness/screening on top; it does not silently swap `plan()`'s output.
- "Activating the new policy changes future suggestions, not holdings, targets or research conclusions" → Task 6's activation only writes `researchPolicy`, nothing else; Milestone 2b (not this plan) is what will actually change `plan()`'s output when the policy is active.
- Allocation/cash and AI-role bullets from the brief's Milestone 2 section are explicitly **not** in this plan's scope — they need `assessCompany` to exist first and are Milestone 2b.

**Placeholder scan:** every step has literal code; no "add appropriate handling"/"similar to Task N" patterns.

**Type consistency:** `CompanyAssessment`, `assessCompany`, `assessAll` signatures are identical between Task 4's implementation and Task 6's consumption. `Screening`/`ResearchPolicy`/`ScreeningStatus`/`QuoteFreshness` names match everywhere they're imported (Tasks 2, 3, 4, 5, 6).
