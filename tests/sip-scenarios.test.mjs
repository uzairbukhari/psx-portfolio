import test from 'node:test';
import assert from 'node:assert/strict';
import { projectSip, projectScenario } from '../lib/sip-blueprint.ts';
import {
  compareScenarios,
  goalWays,
  goalTakeaway,
  leverKind,
  leverLabel,
  scenarioPresets,
  summarizeLine,
  checkpointYears,
} from '../lib/sip-scenarios.ts';

const base = { monthly: 50_000, annualPct: 11.8, stepUpPct: 0, inflationPct: 9.6 };

test('no changes equals projectSip', () => {
  assert.deepEqual(projectScenario(base, {}, 20), projectSip({ ...base, years: 20 }));
});

test('zero return: money in is what was put in, whatever the levers', () => {
  const z = { monthly: 10_000, annualPct: 0 };
  assert.equal(projectScenario(z, { stopAfterYears: 2 }, 5).at(-1).value, 240_000);
  assert.equal(projectScenario(z, { startDelayYears: 1 }, 3).at(-1).invested, 240_000);
  assert.equal(projectScenario(z, { pause: { fromYear: 1, months: 6 } }, 1).at(-1).invested, 60_000);
  assert.equal(projectScenario(z, { skipMonthsPerYear: 2 }, 1).at(-1).invested, 100_000);
  assert.equal(projectScenario(z, { extra: { amount: 5_000, year: 2, yearly: true } }, 3).at(-1).invested, 360_000 + 10_000);
  assert.equal(projectScenario(z, { extra: { amount: 5_000, year: 2, yearly: false } }, 3).at(-1).invested, 365_000);
});

test('stop after N years: the value at the stop keeps compounding with no new money', () => {
  const stopped = projectScenario(base, { stopAfterYears: 3 }, 20);
  const at3 = stopped[3].value;
  assert.ok(Math.abs(stopped[20].value - at3 * Math.pow(1 + 0.118, 17)) / stopped[20].value < 1e-9);
  assert.equal(stopped[20].invested, stopped[3].invested);
});

test('raise: step-up counts from the first year money goes in', () => {
  const z = { monthly: 10_000, annualPct: 0 };
  const late = projectScenario(z, { startDelayYears: 1, stepUp: 10 }, 3);
  assert.equal(late.at(-1).invested, 120_000 + 132_000);
});

test('a fall applies once at the start of its year', () => {
  const z = { monthly: 0, annualPct: 0, startValue: 1_000 };
  const p = projectScenario(z, { fall: { pct: 30, year: 2 } }, 3);
  assert.equal(p[1].value, 1_000);
  assert.ok(Math.abs(p[2].value - 700) < 1e-9);
  assert.ok(Math.abs(p[3].value - 700) < 1e-9);
});

test('start value counts as money in and grows', () => {
  const p = projectScenario({ monthly: 0, annualPct: 10 }, {}, 10);
  assert.equal(p[0].value, 0);
  const q = projectScenario({ monthly: 0, annualPct: 10, startValue: 2_000_000 }, {}, 10);
  assert.equal(q[0].invested, 2_000_000);
  assert.ok(Math.abs(q[10].value - 2_000_000 * 1.1 ** 10) < 1);
});

test('compareScenarios keeps the plan first, at most two what-ifs, and signs the deltas', () => {
  const c = compareScenarios(
    base,
    [
      { key: 'a', levers: { stopAfterYears: 3 } },
      { key: 'b', levers: { stepUp: 10 } },
      { key: 'c', levers: { startDelayYears: 2 } },
    ],
    20,
    { startYear: 2026 },
  );
  assert.equal(c.lines.length, 3);
  assert.equal(c.lines[0].delta, null);
  assert.ok(c.lines[1].delta.value < 0);
  assert.ok(c.lines[2].delta.value > 0);
  assert.match(c.takeaway, /Stopping after 3 years/);
  assert.match(c.takeaway, /by 2046/);
});

test('checkpoints stay inside the look-ahead', () => {
  assert.deepEqual(checkpointYears(3), [3]);
  assert.deepEqual(checkpointYears(20), [5, 10, 20]);
  assert.deepEqual(checkpointYears(40), [5, 10, 20, 30, 40]);
  const s = summarizeLine(projectSip({ ...base, years: 20 }), 20, false, 1e7);
  assert.equal(s.yearReached, 10);
});

test('real figures deflate', () => {
  const pts = projectSip({ ...base, years: 10 });
  assert.ok(summarizeLine(pts, 10, true).value < summarizeLine(pts, 10, false).value);
});

test('presets: the raise chip never repeats the plan and the extra scales with the plan', () => {
  assert.equal(scenarioPresets(base).find((p) => p.key === 'raise').levers.stepUp, 10);
  assert.equal(scenarioPresets({ ...base, stepUpPct: 10 }).find((p) => p.key === 'raise').levers.stepUp, 15);
  assert.equal(scenarioPresets(base).find((p) => p.key === 'extra').levers.extra.amount, 100_000);
  assert.equal(scenarioPresets({ ...base, monthly: 5_000 }).find((p) => p.key === 'extra').levers.extra.amount, 10_000);
});

test('labels and kinds', () => {
  assert.equal(leverKind({ stopAfterYears: 3 }), 'stop');
  assert.equal(leverKind({ stopAfterYears: 3, stepUp: 10 }), 'custom');
  assert.equal(leverKind({}), 'custom');
  assert.equal(leverLabel({ stopAfterYears: 3, stepUp: 10 }), 'Stop after 3 years + Raise 10% a year');
});

test('goal: year reached, monthly needed and raise needed round-trip', () => {
  const g = goalWays(base, 3e7, 14);
  assert.equal(g.onTrack, false);
  const check = projectScenario(base, { monthly: g.monthlyNeeded }, 14)[14].value;
  assert.ok(check >= 3e7 && check < 3e7 * 1.01);
  const step = projectScenario(base, { stepUp: g.stepUpNeeded }, 14)[14].value;
  assert.ok(step >= 3e7 && step < 3e7 * 1.01);
  assert.equal(g.yearsToReach, 17);
  assert.match(goalTakeaway(g, 2026), /short/);
});

test('goal without a deadline only answers the year; a start value brings it sooner', () => {
  const g = goalWays(base, 6e7);
  assert.equal(g.deadlineYears, undefined);
  assert.equal(g.yearsToReach, 23);
  assert.equal(goalWays({ ...base, startValue: 2e6 }, 6e7).yearsToReach, 20);
  assert.match(goalTakeaway(g, 2026), /in 23 years \(2049\)/);
});

test('goal: already on track and out of reach', () => {
  assert.equal(goalWays(base, 1e6, 5).onTrack, true);
  assert.equal(goalWays({ ...base, monthly: 1 }, 1e12).yearsToReach, null);
  assert.equal(goalWays({ ...base, startValue: 5e6, monthly: 1000 }, 1e6, 5).monthlyNeeded, 0);
});
