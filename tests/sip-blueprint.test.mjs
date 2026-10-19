import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIP_CLASSES,
  SIP_PRESETS,
  blankBlueprint,
  encouragement,
  gramsFor,
  monthProgress,
  monthsBack,
  planMonth,
  presetTargets,
  setTarget,
  sipHistory,
  targetsTotal,
  validateBlueprint,
} from '../lib/sip-blueprint.ts';
import { mergeActual, startOfMonthWeights, withQuickEntry, moneyInByMonth } from '../lib/sip-blueprint-data.ts';
import { blankPortfolio, validate } from '../lib/portfolio.ts';

const sum = (o) => SIP_CLASSES.reduce((n, k) => n + o[k], 0);

test('every preset adds up to 100', () => {
  for (const p of Object.values(SIP_PRESETS)) assert.equal(targetsTotal(p.targets), 100);
});

test('setTarget keeps the total at 100 and never goes negative', () => {
  let t = presetTargets('balanced');
  for (const [k, v] of [['stocks', 90], ['gold', 33], ['currency', 100], ['funds', 0]]) {
    t = setTarget(t, k, v);
    assert.equal(targetsTotal(t), 100, `${k}=${v}`);
    for (const c of SIP_CLASSES) assert.ok(t[c] >= 0);
  }
  // Everything else at zero: the room is shared out.
  const only = setTarget({ stocks: 100, funds: 0, gold: 0, currency: 0 }, 'stocks', 40);
  assert.equal(targetsTotal(only), 100);
});

test('planMonth: amounts add up to the budget, strict follows the targets', () => {
  const t = presetTargets('balanced');
  const strict = planMonth(50_000, t, { stocks: 10, funds: 10, gold: 70, currency: 5 }, true);
  assert.equal(sum(strict), 50_000);
  assert.equal(strict.stocks, 25_000);
  assert.equal(strict.funds, 15_000);
  assert.equal(strict.gold, 7_500);
});

test('planMonth: money leans toward the class below target and never sells', () => {
  const t = presetTargets('balanced'); // gold 10
  const weights = { stocks: 55, funds: 31, gold: 2, currency: 6 };
  const plan = planMonth(30_000, t, weights, false);
  const strict = planMonth(30_000, t, weights, true);
  assert.equal(sum(plan), 30_000);
  assert.ok(plan.gold > strict.gold, 'gold is under target so it gets more');
  assert.ok(plan.stocks < strict.stocks, 'stocks are over target so they get less');
  for (const k of SIP_CLASSES) assert.ok(plan[k] >= 0);
});

test('planMonth: nothing held falls back to the plain split; zero targets stay zero', () => {
  const t = presetTargets('aggressive');
  const plan = planMonth(10_000, t, null, false);
  assert.equal(sum(plan), 10_000);
  assert.equal(plan.currency, 0);
  const onTarget = planMonth(10_000, t, { ...t }, false);
  assert.deepEqual(onTarget, plan);
});

test('planMonth: odd budgets still add up', () => {
  for (const budget of [1, 99, 100, 12_345, 33_333]) {
    const plan = planMonth(budget, presetTargets('balanced'), { stocks: 20, funds: 20, gold: 20, currency: 20 }, false);
    assert.equal(sum(plan), budget, String(budget));
  }
});

test('gramsFor uses the 24K rate and refuses without one', () => {
  assert.equal(gramsFor(7_500, 30_000), 0.25);
  assert.equal(gramsFor(7_500, null), null);
  assert.equal(gramsFor(7_500, 30_000, 22), 7_500 / (30_000 * (22 / 24)));
});

test('monthProgress caps each class at its plan', () => {
  const plan = { stocks: 25_000, funds: 15_000, gold: 7_500, currency: 2_500 };
  const p = monthProgress(plan, { stocks: 30_000, funds: 10_000 });
  assert.equal(p.planned, 50_000);
  assert.equal(p.done, 35_000);
  assert.equal(p.percent, 70);
});

test('history and streak: 80% counts, the running month never breaks it', () => {
  const b = { ...blankBlueprint('2026-01', 10_000), months: {} };
  const actual = { '2026-01': 9_000, '2026-02': 8_000, '2026-03': 5_000, '2026-04': 10_000, '2026-05': 9_000 };
  const inMay = sipHistory(b, actual, '2026-05', 5);
  assert.equal(inMay.thisMonthMet, true);
  assert.equal(inMay.streak, 2);
  assert.equal(inMay.longest, 2);
  // May still empty: the streak holds at April's run.
  const early = sipHistory(b, { ...actual, '2026-05': 100 }, '2026-05', 5);
  assert.equal(early.thisMonthMet, false);
  assert.equal(early.streak, 1);
});

test('history: months before the blueprint are not judged; a month snapshot wins', () => {
  const b = { budget: 10_000, since: '2026-03', months: { '2026-04': { budget: 20_000, plan: {}, done: {} } } };
  const { rows } = sipHistory(b, { '2026-02': 50_000, '2026-03': 10_000, '2026-04': 10_000 }, '2026-04', 3);
  assert.deepEqual(rows.map((r) => [r.target, r.met]), [[0, false], [10_000, true], [20_000, false]]);
});

test('monthsBack crosses a year', () => {
  assert.deepEqual(monthsBack('2026-02', 3), ['2025-12', '2026-01', '2026-02']);
});

test('encouragement names the streak', () => {
  assert.match(encouragement(4, true, 100), /4-month streak/);
  assert.match(encouragement(0, false, 0), /Start/);
});

test('mergeActual takes the larger of ledger and tick, never the sum', () => {
  const merged = mergeActual(
    { '2026-05': { gold: 5_000 } },
    { '2026-05': { budget: 1, plan: {}, done: { gold: { amount: 5_000, date: '2026-05-02' }, funds: { amount: 2_000, date: '2026-05-03' } } } },
  );
  assert.equal(merged['2026-05'].gold, 5_000);
  assert.equal(merged['2026-05'].funds, 2_000);
});

test('startOfMonthWeights removes what went in this month', () => {
  const w = startOfMonthWeights({ stocks: 60, funds: 30, gold: 10, currency: 0 }, { gold: 10 });
  assert.equal(Math.round(w.stocks), 67);
  assert.equal(w.gold, 0);
  assert.equal(startOfMonthWeights({ stocks: 5, funds: 0, gold: 0, currency: 0 }, { stocks: 5 }), null);
});

test('withQuickEntry adds to a matching holding or starts a new one, and the ledger still validates', () => {
  const base = blankPortfolio();
  const once = withQuickEntry(base, { class: 'gold', date: '2026-05-02', grams: 2, amount: 60_000 });
  assert.equal(once.assets.length, 1);
  const twice = withQuickEntry(once, { class: 'gold', date: '2026-05-03', grams: 1, amount: 31_000 });
  assert.equal(twice.assets.length, 1);
  assert.equal(twice.assets[0].entries.length, 2);
  const usd = withQuickEntry(twice, { class: 'currency', date: '2026-05-04', currency: 'USD', units: 50, pkr: 14_000 });
  assert.equal(usd.assets.length, 2);
  validate({ ...usd, sipBlueprint: blankBlueprint('2026-05') });
  assert.equal(base.assets, undefined, 'input is not changed');
});

test('moneyInByMonth reads gold and currency purchases per class', () => {
  const p = withQuickEntry(
    withQuickEntry(blankPortfolio(), { class: 'gold', date: '2026-05-02', grams: 2, amount: 60_000 }),
    { class: 'currency', date: '2026-05-04', currency: 'USD', units: 50, pkr: 14_000 },
  );
  const by = moneyInByMonth([{ id: 'a', name: 'A', portfolio: p }], '2026-05-31');
  assert.equal(by['2026-05'].gold, 60_000);
  assert.equal(by['2026-05'].currency, 14_000);
});

test('validateBlueprint rejects a split that is not 100 and bad months', () => {
  const ok = blankBlueprint('2026-05');
  validateBlueprint(ok);
  assert.throws(() => validateBlueprint({ ...ok, targets: { ...ok.targets, stocks: 51 } }), /100/);
  assert.throws(() => validateBlueprint({ ...ok, since: '2026-13' }), /start month/);
  assert.throws(() => validateBlueprint({ ...ok, budget: -1 }), /budget/);
  assert.throws(
    () => validateBlueprint({ ...ok, months: { '2026-05': { budget: 1, plan: ok.targets, done: { bonds: { amount: 1, date: '2026-05-01' } } } } }),
    /done class/,
  );
});
