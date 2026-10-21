import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestAccount } from '../lib/test-seed/account.ts';
import { today } from '../lib/portfolio.ts';
import { normalizeAccount, accountSipBlueprint } from '../lib/portfolio-account.ts';
import { SIP_CLASSES, STREAK_THRESHOLD, blankBlueprint, planMonth } from '../lib/sip-blueprint.ts';
import { logRate, monthLong, ordinal, rowHint, sipMonthState, sipView } from '../lib/sip-blueprint-data.ts';

const asOf = today();
const account = normalizeAccount(buildTestAccount(asOf), false);
const parts = account.portfolios;
const blueprint = accountSipBlueprint(account);
const rates = {
  metalRates: [{ metal: 'gold', date: asOf, kind: 'local', pkrPerTola: 345_000, sourceUrl: 'https://example.test', fetchedAt: new Date().toISOString() }],
  fxRates: [{ currency: 'USD', date: asOf, kind: 'open_market', pkrPerUnit: 283, sourceUrl: 'https://example.test', fetchedAt: new Date().toISOString() }],
};
const goldPerGram = 345_000 / 11.6638;

test('the seed carries a blueprint the view can read', () => {
  assert.ok(blueprint, 'lib/test-seed/account.ts seeds a SIP blueprint');
  assert.equal(Math.round(SIP_CLASSES.reduce((n, k) => n + blueprint.targets[k], 0)), 100);
});

test('the view matches the month state it is built from', () => {
  const view = sipView(blueprint, parts, asOf, rates);
  const state = sipMonthState(blueprint, parts, asOf, rates);
  assert.deepEqual(view.state.plan, state.plan);
  assert.equal(view.state.progress.percent, state.progress.percent);
  assert.equal(view.day, blueprint.day ?? 1);
  assert.equal(view.strict, blueprint.strict);
  assert.equal(view.hero.month, asOf.slice(0, 7));
  assert.equal(view.hero.streak, state.history.streak);
  assert.ok(view.hero.encouragement.length > 0);
});

test('every row says what to do next and keeps the plan total', () => {
  const view = sipView(blueprint, parts, asOf, rates);
  assert.ok(view.rows.length > 0);
  const total = view.rows.reduce((n, r) => n + r.amount, 0);
  assert.equal(total, view.state.progress.planned);
  for (const row of view.rows) {
    assert.ok(row.label.length > 0 && row.hint.length > 0);
    assert.ok(['picks', 'holdings', 'log', 'mark'].includes(row.action));
    assert.equal(row.diff, row.amount - row.target);
    if (row.key === 'gold' || row.key === 'currency') assert.ok(row.rate !== null, `${row.key} has a public rate`);
    else assert.equal(row.rate, null);
  }
  assert.equal(view.rows.find((r) => r.key === 'gold')?.action, 'log', 'gold is logged in place');
  assert.equal(view.rows.find((r) => r.key === 'funds')?.action, 'holdings', 'funds open Holdings');
});

test('the stocks row offers Holdings when no company is held, and nothing can be logged when every portfolio is locked', () => {
  // A budget nothing this month can cover, so no row counts as done and every row still offers its action.
  const big = { ...blueprint, budget: 5_000_000, months: {} };
  assert.equal(sipView(big, parts, asOf, rates, { hasStocks: true }).rows.find((r) => r.key === 'stocks')?.action, 'picks');
  assert.equal(sipView(big, parts, asOf, rates, { hasStocks: false }).rows.find((r) => r.key === 'stocks')?.action, 'holdings');
  const locked = sipView(big, parts, asOf, rates, { canLog: false });
  assert.ok(!locked.rows.some((r) => r.action === 'log'), 'a locked account cannot log a purchase');
  assert.equal(locked.rows.find((r) => r.key === 'gold')?.action, 'mark');
});

test('hints use the public rates and fall back without them', () => {
  assert.match(rowHint('gold', 10_000, rates, asOf), /g of 24K at Rs/);
  assert.equal(rowHint('gold', 10_000, {}, asOf), '24K coins or bars');
  assert.match(rowHint('currency', 10_000, rates, asOf), /^≈ \$35 as a cash reserve$/);
  assert.equal(rowHint('currency', 10_000, {}, asOf), 'Dollars, dirhams or riyals as a reserve');
  assert.equal(rowHint('stocks', 10_000, rates, asOf), 'From your shortlist or Monthly Picks');
  assert.equal(Math.round(logRate('gold', rates, asOf)), Math.round(goldPerGram));
  assert.equal(logRate('currency', rates, asOf), 283);
  assert.equal(logRate('stocks', rates, asOf), null);
});

test('the hero status follows the SIP day and the nudge only fires when behind', () => {
  const month = asOf.slice(0, 7);
  const base = { ...blankBlueprint(month, 50_000), notify: true };
  const onDay = sipView({ ...base, day: Number(asOf.slice(8)) }, parts, asOf, rates);
  assert.equal(onDay.hero.status, 'Today is your SIP day');
  const dayOfMonth = Number(asOf.slice(8));
  if (dayOfMonth < 28) {
    const later = sipView({ ...base, day: dayOfMonth + 1 }, parts, asOf, rates);
    assert.equal(later.hero.status, 'SIP day in 1 day');
    assert.equal(later.hero.nudge, null, 'a SIP day still ahead is never behind');
  }
  if (dayOfMonth > 4) {
    const passed = sipView({ ...base, day: 1 }, parts, asOf, rates);
    assert.match(passed.hero.status, /^SIP day was the 1st$/);
    const done = passed.state.progress.percent >= STREAK_THRESHOLD * 100;
    assert.equal(passed.hero.nudge === null, done);
    if (!done) assert.match(passed.hero.nudge, /keep your streak/);
  }
  // A month with nothing planned is not "complete".
  const empty = sipView({ ...base, budget: 0, targets: planMonth(0, base.targets, null, true) && base.targets }, parts, asOf, rates);
  assert.equal(empty.hero.complete, false);
});

test('month names and ordinals read the way people say them', () => {
  assert.equal(monthLong('2026-10'), 'October');
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});
