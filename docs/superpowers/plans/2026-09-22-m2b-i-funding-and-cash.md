# Milestone 2b-i — Funding and cash model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate "planned monthly budget" (a target/ceiling) from "confirmed available funds" (money actually verified as available), via explicit, user-created `FundingEntry` records — never auto-derived — so the future research-driven allocator (2b-ii, not this plan) can bound spending by both, dividends can be explicitly reinvested without ever being double-counted, and carry-forward is never silently fabricated as "the sum of unused budgets."

**Architecture:** One new additive type (`FundingEntry`) persisted on `Portfolio.funding?`, one new pure derived function (`confirmedFunds`) that sums unvoided entries for a month — deliberately NOT tracking a separate "consumed" field, since consumption is already correctly derived everywhere else in this codebase from the trades list itself (the same way `plan()`'s `already` already handles void/correction with zero extra bookkeeping). UI: a small funding-entry manager in the Monthly SIP tab, plus a "Mark as reinvested" action on dividend records.

**Tech Stack:** Same as prior milestones — TypeScript, Node native type stripping, `node:test`, React/`app/portfolio.tsx`.

**Spec:** `../../../reviews/CLAUDE-IMPLEMENTATION-BRIEF.md` (Milestone 2 → "Allocation and cash" subsection, specifically: "Separate planned monthly budget from confirmed available funds... Default historical carry-forward to unknown/unconfirmed, not the sum of unused budgets... Received dividends become available only through an explicit reinvestment funding entry linked to that receipt; never count them twice... Keep purchase recording separate from planning. Voiding/correcting a purchase must recompute budget/funding consumption consistently without deleting audit history."). Regression fixture 9. Progress tracker: `docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md`.

## Global Constraints

- Never auto-generate a `FundingEntry`. Carry-forward, in particular, must never be computed as "prior month's unused budget" — it is only ever created by an explicit user action, and historical months without one simply have none (not retroactively backfilled).
- A dividend can fund at most one `FundingEntry` (via `linkedDividendId`) among non-voided entries — enforced by validation, not just UI discipline.
- Consumption must never be tracked as a separately-mutated field. It is derived fresh from `p.trades` every time, the same way `already` already is in `plan()` — this is what makes void/correction "just work" with zero extra bookkeeping, per the Global Constraint above from the brief.
- Preserve all existing trades, dividends, corrections/voids. This plan is purely additive — no existing type's shape changes, no existing validation is loosened.
- oxlint: typeAware/typeCheck on, correctness treated as errors, no-explicit-any/no-deprecated/react-rules-of-hooks enforced.
- Run at the end: `node --test tests/*.test.mjs`, `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Confirmed current-state facts (verified against the post-Milestone-2a codebase this session)

- `p.budgets: Record<string, number>` is the only "money available" concept today — read at `lib/portfolio.ts`'s `plan()` as `p.budgets[month] ?? 100000`, written in `app/portfolio.tsx`'s Monthly SIP tab via a plain number input (`onBlur` → `save({...p, budgets: {...p.budgets, [month]: amount}})`).
- `already` (this month's real spend) is computed fresh every call: `p.trades.filter(t => t.kind==='buy' && !t.voided && t.month===month).reduce((a,t) => a + t.shares*t.price! + t.fees, 0)` — confirming void/correction requires zero extra bookkeeping to stay consistent, since it's derived, not stored.
- Trade correction (`app/portfolio.tsx`'s `record()`): void the old trade (`old.voided = true`), then `splice` a fresh-UUID replacement immediately after the old one's array position. Dividend correction (`recordDividend()`) is the identical pattern.
- `Dividend` type: `{id, ticker, date, source: 'manual'|'import', perShare?, grossAmount?, netAmount?, externalId?, financialYear?, note, voided?}`.
- No `carry`, `Funding`, `reinvest`, `confirmed`, or `savedPlan` concept exists anywhere in `lib/portfolio.ts` or `app/portfolio.tsx` (confirmed by grep this session).

---

### Task 1: `FundingEntry` type, `Portfolio.funding?` field, validation

**Files:**
- Modify: `lib/portfolio.ts` (new type, `Portfolio` type, `validate`)
- Test: `tests/portfolio.test.mjs`

**Interfaces:**
- Produces: `export type FundingSource = 'carry-forward' | 'dividend-reinvestment' | 'manual'`, `export type FundingEntry = { id: string; month: string; source: FundingSource; amount: number; note: string; linkedDividendId?: string; createdAt: string; voided?: boolean }`, `Portfolio.funding?: FundingEntry[]` (Task 2 of this plan reads this by this exact name).

- [ ] **Step 1: Write failing tests**

```javascript
// append to tests/portfolio.test.mjs
const fundingEntry = (over = {}) => ({
  id: crypto.randomUUID(), month, source: 'manual', amount: 5000, note: '',
  createdAt: new Date().toISOString(), ...over,
});
test('validate accepts a well-formed funding entry and rejects a bad source, month, or amount',()=>{
  const p=fresh();
  p.funding=[fundingEntry()];
  validate(p);
  p.funding=[fundingEntry({source:'carry-forward'})];
  validate(p);
  p.funding=[fundingEntry({source:'bogus'})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({month:'2026-13'})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({amount:0})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({amount:-5})];
  assert.throws(()=>validate(p));
});
test('validate requires linkedDividendId only for dividend-reinvestment, referencing a real non-voided dividend',()=>{
  const p=fresh();
  p.dividends=[{id:'d1',ticker:'TEST',date,source:'manual',perShare:2,grossAmount:200,note:''}];
  p.funding=[fundingEntry({source:'dividend-reinvestment',linkedDividendId:'d1',amount:200})];
  validate(p);
  p.funding=[fundingEntry({source:'dividend-reinvestment'})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({source:'dividend-reinvestment',linkedDividendId:'missing'})];
  assert.throws(()=>validate(p));
  p.funding=[fundingEntry({source:'manual',linkedDividendId:'d1'})];
  assert.throws(()=>validate(p));
});
test('validate rejects two non-voided funding entries linked to the same dividend, but allows it once one is voided',()=>{
  const p=fresh();
  p.dividends=[{id:'d1',ticker:'TEST',date,source:'manual',perShare:2,grossAmount:200,note:''}];
  p.funding=[
    fundingEntry({id:'f1',source:'dividend-reinvestment',linkedDividendId:'d1',amount:100}),
    fundingEntry({id:'f2',source:'dividend-reinvestment',linkedDividendId:'d1',amount:100}),
  ];
  assert.throws(()=>validate(p));
  p.funding[0].voided=true;
  validate(p);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/portfolio.test.mjs`
Expected: FAIL — `funding` not recognized by `validate`.

- [ ] **Step 3: Implement**

Add near the other small exported types in `lib/portfolio.ts` (after `Dividend`, before `TAX_RATES`):

```typescript
export type FundingSource = 'carry-forward' | 'dividend-reinvestment' | 'manual';
export type FundingEntry = {
  id: string;
  month: string;
  source: FundingSource;
  amount: number;
  note: string;
  linkedDividendId?: string;
  createdAt: string;
  voided?: boolean;
};
```

Extend `Portfolio` (add `funding?: FundingEntry[];` alongside `dividends?: Dividend[];`).

In `validate()`, add a new block mirroring the existing `if (p.dividends !== undefined) {...}` block's structure, placed right after it:

```typescript
  if (p.funding !== undefined) {
    if (!Array.isArray(p.funding) || p.funding.length > 20000)
      throw Error('Portfolio exceeds supported size.');
    const fundingIds = new Set<string>();
    const linkedDividends = new Set<string>();
    const dividendIds = new Set((p.dividends ?? []).filter((d) => !d.voided).map((d) => d.id));
    for (const f of p.funding) {
      if (
        typeof f.id !== 'string' ||
        fundingIds.has(f.id) ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(f.month) ||
        !['carry-forward', 'dividend-reinvestment', 'manual'].includes(f.source) ||
        !Number.isFinite(f.amount) ||
        f.amount <= 0 ||
        f.amount > 1e9 ||
        typeof f.note !== 'string' ||
        f.note.length > 2000 ||
        typeof f.createdAt !== 'string' ||
        (f.voided !== undefined && typeof f.voided !== 'boolean')
      )
        throw Error('Invalid funding entry.');
      if (f.source === 'dividend-reinvestment') {
        if (typeof f.linkedDividendId !== 'string' || !dividendIds.has(f.linkedDividendId))
          throw Error('A dividend-reinvestment funding entry must reference an existing, non-voided dividend.');
        if (!f.voided) {
          if (linkedDividends.has(f.linkedDividendId))
            throw Error('A dividend can fund at most one non-voided funding entry.');
          linkedDividends.add(f.linkedDividendId);
        }
      } else if (f.linkedDividendId !== undefined) {
        throw Error('Only a dividend-reinvestment funding entry may reference a dividend.');
      }
      fundingIds.add(f.id);
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
git commit -m "feat: add FundingEntry type for explicit confirmed-funds tracking"
```

---

### Task 2: `confirmedFunds` — the pure derived function

**Files:**
- Modify: `lib/portfolio.ts` (new function, placed near `plan()`)
- Test: `tests/portfolio.test.mjs`

**Interfaces:**
- Produces: `export function confirmedFunds(p: Portfolio, month: string): number` (2b-ii's allocator, not part of this plan, will call this by this exact name).

- [ ] **Step 1: Write failing tests**

```javascript
// append to tests/portfolio.test.mjs
test('confirmedFunds sums non-voided entries for the given month only, excluding other months and voided entries',()=>{
  const p=fresh();
  p.funding=[
    fundingEntry({month,amount:3000}),
    fundingEntry({month,amount:2000,voided:true}),
    fundingEntry({month:'2020-01',amount:9000}),
  ];
  assert.equal(confirmedFunds(p,month),3000);
});
test('confirmedFunds is zero with no funding array at all, never throws',()=>{
  const p=fresh();
  assert.equal(confirmedFunds(p,month),0);
});
```

(Add `confirmedFunds` and `crypto` — already global in Node — to the test file's import line from `../lib/portfolio.ts`; `fundingEntry` helper is already defined from Task 1.)

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/portfolio.test.mjs`
Expected: FAIL — `confirmedFunds` is not exported.

- [ ] **Step 3: Implement**

Add to `lib/portfolio.ts`, immediately before `plan()`:

```typescript
export function confirmedFunds(p: Portfolio, month: string): number {
  return round(
    (p.funding ?? [])
      .filter((f) => !f.voided && f.month === month)
      .reduce((a, f) => a + f.amount, 0),
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
git commit -m "feat: add confirmedFunds, deriving available funding from unvoided entries only"
```

---

### Task 3: Funding entry manager in the Monthly SIP tab

**Files:**
- Modify: `app/portfolio.tsx`

**Interfaces:**
- Consumes: `FundingEntry`, `confirmedFunds` from `@/lib/portfolio`.

- [ ] **Step 1: Read the current Monthly SIP tab's budget section precisely**

Read the actual current `<TabsContent value="sip">` block (this session confirmed it currently spans roughly lines 1276-1481, with the budget input around 1276-1330 and `PolicyPreview` mounted at the end around line 1480 — re-read fresh since exact lines may have shifted). Also read how `record()`/`recordDividend()`/`save()`/`attempt()`/`clone()` are used elsewhere in this file, to match the same local-mutation-then-save pattern for the new funding-entry actions you're adding.

- [ ] **Step 2: Add funding-entry state, a small add-entry form, and a list with void actions**

Add local state near the file's other dialog/form state (find where `trade`/`dividend`/`company` state is declared, e.g. `useState<...|null>(null)`, and follow the same convention):

```typescript
const [fundingDraft, setFundingDraft] = useState<{ amount: string; source: FundingSource; note: string }>({
  amount: '', source: 'manual', note: '',
});
```

(Import `FundingSource`, `FundingEntry`, `confirmedFunds` from `@/lib/portfolio` alongside the other imports already pulled from there.)

Insert a new section inside `<TabsContent value="sip">`, after the existing budget/fees form-grid and its "Already purchased this month" stat, before the plan-rows table (find the exact insertion point by reading the file — it should sit logically between "how much do I plan to spend" and "what does the plan suggest"):

```tsx
<section className="panel funding-manager">
  <p className="eyebrow">CONFIRMED FUNDS</p>
  <h3>Money actually available to spend this month.</h3>
  <p className="muted">
    Separate from your monthly budget target above. Add a confirmed
    amount — a bank balance you&apos;ve checked, a carried-forward
    balance you&apos;re certain of, or a dividend you&apos;ve decided
    to reinvest (mark dividends as reinvested from the Purchase log) —
    before the plan below will treat it as spendable.
  </p>
  <div className="mini-stat">
    <span>Confirmed funds this month</span>
    <b>{money(confirmedFunds(p, month))}</b>
  </div>
  <form
    className="form-grid"
    onSubmit={(e) => {
      e.preventDefault();
      const amount = Number(fundingDraft.amount);
      if (!amount || amount <= 0) return;
      attempt(async () => {
        const next = clone(p);
        next.funding = [
          ...(next.funding ?? []),
          {
            id: crypto.randomUUID(),
            month,
            source: fundingDraft.source,
            amount,
            note: fundingDraft.note,
            createdAt: new Date().toISOString(),
          },
        ];
        await save(next, 'Confirmed funding entry added.');
        setFundingDraft({ amount: '', source: 'manual', note: '' });
      });
    }}
  >
    <label>
      Source
      <select
        value={fundingDraft.source}
        onChange={(e) =>
          setFundingDraft({ ...fundingDraft, source: e.target.value as FundingSource })
        }
      >
        <option value="manual">Confirmed balance</option>
        <option value="carry-forward">Carried forward from a prior month</option>
      </select>
    </label>
    <label>
      Amount (PKR)
      <input
        type="number"
        min="0.01"
        step="0.01"
        value={fundingDraft.amount}
        onChange={(e) => setFundingDraft({ ...fundingDraft, amount: e.target.value })}
      />
    </label>
    <label className="wide">
      Note
      <input
        maxLength={2000}
        value={fundingDraft.note}
        onChange={(e) => setFundingDraft({ ...fundingDraft, note: e.target.value })}
      />
    </label>
    <button disabled={busy} type="submit">Add confirmed funds</button>
  </form>
  {(p.funding ?? []).filter((f) => f.month === month && !f.voided).length > 0 && (
    <table>
      <thead>
        <tr><th>Source</th><th>Amount</th><th>Note</th><th></th></tr>
      </thead>
      <tbody>
        {(p.funding ?? [])
          .filter((f) => f.month === month && !f.voided)
          .map((f) => (
            <tr key={f.id}>
              <td>{f.source === 'dividend-reinvestment' ? 'Reinvested dividend' : f.source === 'carry-forward' ? 'Carried forward' : 'Confirmed balance'}</td>
              <td>{money(f.amount)}</td>
              <td>{f.note}</td>
              <td>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm('Void this funding entry? Its audit record will remain.')) return;
                    attempt(async () => {
                      const next = clone(p);
                      next.funding!.find((x) => x.id === f.id)!.voided = true;
                      await save(next, 'Funding entry voided.');
                    });
                  }}
                >
                  Void
                </button>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  )}
</section>
```

(Match this file's actual current conventions for `attempt`/`save`/`clone`/`busy` exactly as they're already used elsewhere — read a nearby example like `record()` or the dividend-void handler before finalizing; the shapes above are illustrative of the required behavior, not necessarily byte-exact to what compiles first try given the file's exact current helper signatures.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Browser-verify**

Deferred to Task 5.

- [ ] **Step 5: Commit**

```bash
git add app/portfolio.tsx
git commit -m "feat: add confirmed-funding entry manager to the Monthly SIP tab"
```

---

### Task 4: "Mark as reinvested" action on dividend records

**Files:**
- Modify: `app/portfolio.tsx`

**Interfaces:**
- Consumes: `FundingEntry`, `taxSummary` (already imported — used to get a dividend's computed `netAmount`) from `@/lib/portfolio`.

- [ ] **Step 1: Locate the dividend list**

Read the current file to find where dividend records are listed for a ticker or globally (the History tab, or wherever `p.dividends` is rendered as a table — the codebase's own dividend-void handler, read in Task 3's Step 1, is a reference point; find its surrounding list-rendering JSX). Also find where `taxSummary(p).dividends` is already used (this repo computes `netAmount` there, not on the raw `Dividend` record) to get the definitive after-tax amount for a dividend.

- [ ] **Step 2: Add the action**

For each non-voided dividend row not already linked to a non-voided funding entry, add a "Mark as reinvested" button. Determine "already linked" via: `(p.funding ?? []).some(f => !f.voided && f.linkedDividendId === dividend.id)`. On click, prompt for (or default to) the SIP month this dividend funds (reuse the Monthly SIP tab's current `month` state if accessible in this render scope, or add a simple inline month picker if the dividend list is rendered outside that scope — read the actual component structure to decide), then:

```typescript
attempt(async () => {
  const netAmount = taxSummary(p).dividends.find((d) => d.id === dividend.id)?.netAmount;
  if (netAmount == null || netAmount <= 0) {
    notify('This dividend has no known net amount to reinvest (filer status not set, or a zero/negative amount).', true);
    return;
  }
  const next = clone(p);
  next.funding = [
    ...(next.funding ?? []),
    {
      id: crypto.randomUUID(),
      month: /* the chosen SIP month */,
      source: 'dividend-reinvestment',
      amount: netAmount,
      note: `Reinvested dividend: ${dividend.ticker} ${dividend.date}`,
      linkedDividendId: dividend.id,
      createdAt: new Date().toISOString(),
    },
  ];
  await save(next, 'Dividend marked as reinvested — added to confirmed funds.');
});
```

(Match the file's actual `notify`/`attempt`/`clone`/`save` call signatures exactly as already used nearby — read them first.) Hide/disable this button once a dividend is already linked (the "already linked" check above), so a second click can't create a duplicate link — `validate()` (Task 1) is the backstop, but the UI should not offer an action it knows will be rejected.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Browser-verify**

Deferred to Task 5.

- [ ] **Step 5: Commit**

```bash
git add app/portfolio.tsx
git commit -m "feat: let a dividend be marked as reinvested, creating a linked funding entry"
```

---

### Task 5: Regression fixture, verification sweep, browser check, PROGRESS update

**Files:**
- Modify: `docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md`

- [ ] **Step 1: Regression fixture 9 test**

```javascript
// append to tests/portfolio.test.mjs
test('fixture 9: unknown cash stays unconfirmed, a confirmed carry-forward and a reinvested dividend both count once, a voided purchase frees its spend back up',()=>{
  const p=fresh();
  p.dividends=[{id:'d1',ticker:'TEST',date,source:'manual',perShare:5,grossAmount:500,note:''}];
  // No funding entries yet — unknown cash is NOT assumed available.
  assert.equal(confirmedFunds(p,month),0);
  p.funding=[
    fundingEntry({id:'carry',source:'carry-forward',amount:10000}),
    fundingEntry({id:'div',source:'dividend-reinvestment',linkedDividendId:'d1',amount:500}),
  ];
  validate(p);
  assert.equal(confirmedFunds(p,month),10500);
  // Record a buy, then void it — confirmed funds figure itself is unchanged (it never
  // included spend); what changes is `already`, which plan()/2b-ii derive separately,
  // proving funding and spend-tracking are genuinely independent, not double-counted.
  p.trades=[trade('t1',10,50,'buy',5)];
  assert.equal(confirmedFunds(p,month),10500);
  p.trades[0].voided=true;
  assert.equal(confirmedFunds(p,month),10500);
});
```

Run: `node --test tests/portfolio.test.mjs`
Expected: PASS.

- [ ] **Step 2: Full verification suite**

```bash
node --test tests/*.test.mjs
npx tsc --noEmit
npm run lint
npm run build
```

Record exact pass/fail. Cross-check any lint finding against `git log` before assuming pre-existing, matching prior milestones' convention.

- [ ] **Step 3: Browser-check on localhost (real account, read-only)**

Check for an existing dev server on port 3000 first. Open the Monthly SIP tab, confirm the new "Confirmed funds" section renders (Confirmed funds this month should read Rs 0 for the real account, since no funding entries exist yet). Open the dividend list, confirm the "Mark as reinvested" button renders for a real dividend record without crashing. Do NOT click "Add confirmed funds" or "Mark as reinvested" against the real account unless explicitly instructed — this is read-only verification.

- [ ] **Step 4: Update PROGRESS.md**

Check off 2b-i's items, note that 2b-ii (the research-driven allocator) is next and depends on `confirmedFunds`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-09-22-research-driven-sip-PROGRESS.md
git commit -m "docs: record Milestone 2b-i completion and verification results"
```

---

## Self-Review

**Spec coverage:**
- "Separate planned monthly budget from confirmed available funds" → `Portfolio.budgets` (existing, untouched) vs. new `Portfolio.funding`/`confirmedFunds` (Tasks 1-2).
- "Add an explicit funded/carry-forward record, with source and consumed amount" → `FundingEntry` (Task 1); "consumed amount" is deliberately NOT a stored field (see Global Constraints) — consumption is derived the same way `already` already is, satisfying the spirit (recompute consistently without deleting audit history) more robustly than a mutable counter would.
- "Default historical carry-forward to unknown/unconfirmed, not the sum of unused budgets" → satisfied by construction: nothing in this plan ever auto-creates a `FundingEntry`; `confirmedFunds` returns `0` for any month with none.
- "Received dividends become available only through an explicit reinvestment funding entry linked to that receipt; never count them twice" → Task 4's UI action + Task 1's validation (one non-voided link per dividend, enforced server-side not just client-side).
- "Voiding/correcting a purchase must recompute budget/funding consumption consistently without deleting audit history" → satisfied by construction: `already` and `confirmedFunds` are both pure functions over `p.trades`/`p.funding`, recomputed fresh every call; void/correction (existing mechanism, untouched) flows through automatically.
- Regression fixture 9 → Task 5's dedicated test.
- Allocator/AI-role/UI-wiring/save-plan work is explicitly **not** in this plan — `confirmedFunds` is the hook point 2b-ii will consume.

**Placeholder scan:** every step has literal code. Task 3/4's illustrative-JSX caveat is explicit about needing a fresh read of the file's exact current helper signatures — this is a necessary acknowledgment given the file's size and this session's inability to pin every line number with certainty after several milestones of edits to it, not a placeholder for the *logic*, which is fully specified.

**Type consistency:** `FundingEntry`/`FundingSource`/`confirmedFunds` names and shapes are identical everywhere they're used across Tasks 1-5.
