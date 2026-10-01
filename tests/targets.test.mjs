import test from 'node:test';
import assert from 'node:assert/strict';
import { WEIGHT_CAP, SCREEN_MAX_AGE_DAYS, plan, today, validate } from '../lib/portfolio.ts';
import { applyTargets, evenWeights, screenStatus, targetRows, targetTotals } from '../lib/targets.ts';

const company = (ticker, extra = {}) => ({ ticker, name: ticker + ' Ltd', sector: 'Banks', target: 0, approved: false, screenDate: '', note: '', ...extra });
const pf = (companies) => ({ companies, trades: [], quotes: {}, budgets: {} });
const pastDate = (days) => new Date(Date.parse(today() + 'T00:00:00Z') - days * 86_400_000).toISOString().slice(0, 10);

test('the 20% cap and 183-day screen rules are the ones plan() uses', () => {
  assert.equal(WEIGHT_CAP, 20);
  assert.equal(SCREEN_MAX_AGE_DAYS, 183);
});

test('targetRows lists only companies with a target', () => {
  const p = pf([company('AAA', { target: 60 }), company('BBB'), company('CCC', { target: 40, approved: true, screenDate: '2026-01-02' })]);
  assert.deepEqual(targetRows(p), [
    { ticker: 'AAA', target: 60, approved: false, screenDate: '' },
    { ticker: 'CCC', target: 40, approved: true, screenDate: '2026-01-02' },
  ]);
});

test('targetTotals reports the running total, what is left and which weights exceed the cap', () => {
  assert.deepEqual(targetTotals([]), { total: 0, remaining: 100, status: 'empty', overCap: [] });
  const under = targetTotals([{ ticker: 'A', target: 20 }, { ticker: 'B', target: 15.5 }]);
  assert.equal(under.total, 35.5);
  assert.equal(under.remaining, 64.5);
  assert.equal(under.status, 'under');
  const exact = targetTotals([{ ticker: 'A', target: 25 }, { ticker: 'B', target: 75 }]);
  assert.equal(exact.status, 'exact');
  assert.deepEqual(exact.overCap, ['A', 'B']);
  const over = targetTotals([{ ticker: 'A', target: 60 }, { ticker: 'B', target: 45 }]);
  assert.equal(over.status, 'over');
  assert.equal(over.remaining, -5);
  // 99.99 is not accepted by plan(), so it is not "exact" here either.
  assert.equal(targetTotals([{ ticker: 'A', target: 50 }, { ticker: 'B', target: 49.99 }]).status, 'under');
  // Weights are totalled as they will be saved (two decimals).
  assert.equal(targetTotals([{ ticker: 'A', target: 33.333 }, { ticker: 'B', target: 33.333 }, { ticker: 'C', target: 33.334 }]).status, 'under');
});

test('evenWeights always add up to exactly 100', () => {
  assert.deepEqual(evenWeights(0), []);
  assert.deepEqual(evenWeights(4), [25, 25, 25, 25]);
  assert.deepEqual(evenWeights(3), [33.34, 33.33, 33.33]);
  for (let n = 1; n <= 40; n++) {
    const w = evenWeights(n);
    assert.equal(w.length, n);
    assert.equal(targetTotals(w.map((target, i) => ({ ticker: 'T' + i, target }))).status, 'exact', `n=${n}`);
  }
});

test('screenStatus follows the same eligibility rule as the plan', () => {
  const asOf = '2026-10-01';
  assert.equal(screenStatus({ approved: false, screenDate: '2026-09-01' }, asOf).state, 'not-enabled');
  assert.equal(screenStatus({ approved: true, screenDate: '' }, asOf).state, 'no-date');
  assert.equal(screenStatus({ approved: true, screenDate: '2026-10-05' }, asOf).state, 'future');
  const valid = screenStatus({ approved: true, screenDate: '2026-09-01' }, asOf);
  assert.equal(valid.state, 'valid');
  assert.equal(valid.validUntil, '2027-03-03');
  assert.match(valid.label, /Screened 2026-09-01, valid to 2027-03-03/);
  assert.equal(screenStatus({ approved: true, screenDate: '2026-04-01' }, '2026-10-01').state, 'valid');
  // 183 days old is still valid; 184 is not (plan() pauses allocations beyond 183 days).
  assert.equal(screenStatus({ approved: true, screenDate: '2026-03-31' }, '2026-10-01').state, 'expired');
});

test('applyTargets sets weights and screening, zeroes the rest, and leaves the input untouched', () => {
  const p = pf([company('AAA', { target: 100 }), company('BBB'), company('CCC')]);
  const next = applyTargets(p, [
    { ticker: 'BBB', target: 60, approved: true, screenDate: '2026-01-02' },
    { ticker: 'CCC', target: 40, approved: false, screenDate: '' },
  ]);
  assert.deepEqual(next.companies.map((c) => [c.ticker, c.target, c.approved, c.screenDate]), [
    ['AAA', 0, false, ''],
    ['BBB', 60, true, '2026-01-02'],
    ['CCC', 40, false, ''],
  ]);
  assert.equal(p.companies[0].target, 100);
  validate(next);
});

test('applyTargets rejects totals other than 100, unknown or repeated companies and bad weights or dates', () => {
  const p = pf([company('AAA'), company('BBB')]);
  const row = (ticker, target, extra = {}) => ({ ticker, target, approved: false, screenDate: '', ...extra });
  assert.throws(() => applyTargets(p, []), /at least one company/);
  assert.throws(() => applyTargets(p, [row('AAA', 50), row('BBB', 40)]), /must total 100% \(they are 90% now\)/);
  assert.throws(() => applyTargets(p, [row('AAA', 60), row('BBB', 60)]), /must total 100%/);
  assert.throws(() => applyTargets(p, [row('ZZZ', 100)]), /ZZZ is not in your portfolio/);
  assert.throws(() => applyTargets(p, [row('AAA', 50), row('AAA', 50)]), /listed twice/);
  assert.throws(() => applyTargets(p, [row('AAA', 0), row('BBB', 100)]), /above 0%/);
  assert.throws(() => applyTargets(p, [row('AAA', 0.004), row('BBB', 99.996)]), /above 0%/);
  assert.throws(() => applyTargets(p, [row('AAA', NaN), row('BBB', 100)]), /above 0%/);
  assert.throws(() => applyTargets(p, [row('AAA', 100, { screenDate: '2026-02-30' })]), /screening date/);
  assert.throws(() => applyTargets(p, [row('AAA', 100, { screenDate: '2099-01-01' })]), /not in the future/);
});

test('targets saved by the editor produce a usable plan', () => {
  const day = pastDate(10);
  const p = pf([company('AAA'), company('BBB')]);
  p.quotes = Object.fromEntries(['AAA', 'BBB'].map((t) => [t, { price: 100, asOf: day, date: day, source: 'x', fetchedAt: day + 'T00:00:00Z' }]));
  p.budgets[today().slice(0, 7)] = 10_000;
  const next = applyTargets(p, [
    { ticker: 'AAA', target: 50, approved: true, screenDate: day },
    { ticker: 'BBB', target: 50, approved: true, screenDate: day },
  ]);
  const result = plan(next, today().slice(0, 7), 0, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.rows.every((r) => r.shares > 0));
});
