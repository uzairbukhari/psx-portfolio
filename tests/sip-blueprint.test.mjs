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

import {
  blendedReturn,
  habitStrip,
  lakh,
  milestones,
  mixAfter,
  nextSipDay,
  projectSip,
  rebalanceEdit,
  skipCost,
} from '../lib/sip-blueprint.ts';
import { sipMonthState, LONG_RUN_INFLATION } from '../lib/sip-blueprint-data.ts';

test('projectSip: zero return is the sum of what went in; step-up applies once a year', () => {
  const flat = projectSip({ monthly: 10_000, years: 3, annualPct: 0 });
  assert.equal(flat.length, 4);
  assert.equal(Math.round(flat[3].value), 360_000);
  const stepped = projectSip({ monthly: 10_000, years: 2, annualPct: 0, stepUpPct: 10 });
  assert.equal(Math.round(stepped[2].invested), 120_000 + 132_000);
  const grown = projectSip({ monthly: 10_000, years: 10, annualPct: 12, inflationPct: 8 });
  assert.ok(grown[10].value > grown[10].invested);
  assert.ok(grown[10].realValue < grown[10].value);
});

test('blendedReturn weighs each class by its target', () => {
  assert.equal(blendedReturn({ stocks: 50, funds: 50, gold: 0, currency: 0 }, { stocks: 20, funds: 10 }), 15);
  assert.equal(blendedReturn({ stocks: 100, funds: 0, gold: 0, currency: 0 }), 14);
});

test('rebalanceEdit keeps the total at the budget and never goes negative', () => {
  const t = { stocks: 50, funds: 30, gold: 15, currency: 5 };
  let plan = { stocks: 12_500, funds: 7_500, gold: 3_700, currency: 1_300 };
  for (const [k, v] of [['stocks', 13_000], ['gold', 0], ['funds', 25_000], ['currency', 999_999], ['stocks', -50]]) {
    plan = rebalanceEdit(plan, k, v, 25_000, t);
    assert.equal(Object.values(plan).reduce((a, b) => a + b, 0), 25_000, `${k}=${v}`);
    for (const x of Object.values(plan)) assert.ok(x >= 0);
  }
  // A class with no target and nothing planned stays at zero.
  const aggr = rebalanceEdit({ stocks: 17_500, funds: 5_000, gold: 2_500, currency: 0 }, 'stocks', 10_000, 25_000, { stocks: 70, funds: 20, gold: 10, currency: 0 });
  assert.equal(aggr.currency, 0);
});

test('skipCost and milestones', () => {
  assert.ok(skipCost(25_000, 15, 12) > 25_000);
  const pts = projectSip({ monthly: 25_000, years: 15, annualPct: 12 });
  const [ten, fifty] = milestones(pts, [1e6, 5e7]);
  assert.ok(ten.year >= 1 && ten.year <= 4);
  assert.equal(fifty.year, null);
});

test('lakh formats the way people say amounts here', () => {
  assert.equal(lakh(25_000), 'Rs 25,000');
  assert.equal(lakh(450_000), 'Rs 4.5 lakh');
  assert.equal(lakh(1_250_000), 'Rs 12.5 lakh');
  assert.equal(lakh(11_800_000), 'Rs 1.18 crore');
});

test('nextSipDay rolls into next month (and next year)', () => {
  assert.deepEqual(nextSipDay('2026-10-03', 5), { date: '2026-10-05', days: 2 });
  assert.deepEqual(nextSipDay('2026-10-05', 5), { date: '2026-10-05', days: 0 });
  assert.equal(nextSipDay('2026-12-20', 5).date, '2027-01-05');
});

test('habitStrip labels each month', () => {
  const rows = [
    { month: '2026-07', target: 0, actual: 0, met: false },
    { month: '2026-08', target: 10, actual: 9, met: true },
    { month: '2026-09', target: 10, actual: 2, met: false },
    { month: '2026-10', target: 10, actual: 0, met: false },
  ];
  assert.deepEqual(habitStrip(rows, '2026-10').map((s) => s.state), ['before', 'met', 'partial', 'current']);
  assert.equal(habitStrip([{ month: '2026-09', target: 10, actual: 0, met: false }], '2026-10')[0].state, 'missed');
});

test('mixAfter adds the plan to what is held', () => {
  const m = mixAfter({ stocks: 100, funds: 0, gold: 0, currency: 0 }, { stocks: 0, funds: 100, gold: 0, currency: 0 });
  assert.equal(m.now.stocks, 100);
  assert.equal(m.after.funds, 50);
  assert.equal(mixAfter({ stocks: 0, funds: 0, gold: 0, currency: 0 }, { stocks: 0, funds: 0, gold: 0, currency: 0 }).now, null);
});

test('sipMonthState: a month snapshot wins and ticks count once', () => {
  const p = withQuickEntry(blankPortfolio(), { class: 'gold', date: '2026-10-02', grams: 1, amount: 4_000 });
  const b = {
    ...blankBlueprint('2026-10', 10_000),
    months: { '2026-10': { budget: 10_000, plan: { stocks: 5_000, funds: 3_000, gold: 1_500, currency: 500 }, done: { funds: { amount: 3_000, date: '2026-10-03' } } } },
  };
  const st = sipMonthState(b, [{ id: 'a', name: 'A', portfolio: p }], '2026-10-19');
  assert.equal(st.plan.stocks, 5_000);
  assert.equal(st.done.gold, true);
  assert.equal(st.done.funds, true);
  assert.equal(st.done.stocks, false);
  assert.equal(st.progress.done, 4_500);
  assert.ok(LONG_RUN_INFLATION > 0);
});

test('validateBlueprint accepts the old shape and the new optional fields', () => {
  const ok = blankBlueprint('2026-05');
  validateBlueprint({ ...ok, day: 5, stepUp: 10, returns: { stocks: 15 } });
  assert.throws(() => validateBlueprint({ ...ok, day: 31 }), /SIP day/);
  assert.throws(() => validateBlueprint({ ...ok, returns: { bonds: 5 } }), /return assumption/);
});

test('rebalanceEdit leaves done rows alone', () => {
  const t = { stocks: 50, funds: 30, gold: 15, currency: 5 };
  const plan = { stocks: 13_100, funds: 9_400, gold: 1_900, currency: 600 };
  const next = rebalanceEdit(plan, 'gold', 3_900, 25_000, t, ['stocks']);
  assert.equal(next.stocks, 13_100);
  assert.equal(next.gold, 3_900);
  assert.equal(Object.values(next).reduce((a, b) => a + b, 0), 25_000);
});
