import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dueEntries,
  planFlows,
  planValue,
  validatePlan,
} from '../lib/plans.ts';
import { validateAssets, valueAsset } from '../lib/assets.ts';
import { accountOverview } from '../lib/account-overview.ts';
import { blankPortfolio } from '../lib/portfolio.ts';

const plan = (over = {}) => ({
  id: 'p1',
  kind: 'plan',
  name: 'Mahana Bachat',
  provider: 'pak-qatar-mbp',
  note: '',
  entries: [],
  valuations: [],
  rules: [],
  ...over,
});
const contribution = (id, date, amount, extra = {}) => ({
  id,
  type: 'contribution',
  date,
  amount,
  note: '',
  ...extra,
});
const redeem = (id, date, amount) => ({
  id,
  type: 'redeem',
  date,
  amount,
  note: '',
});
const statement = (id, date, value) => ({ id, date, value, note: '' });

test('without a statement value the plan is shown at the amount paid in, and says so', () => {
  const v = planValue(
    plan({
      entries: [
        contribution('1', '2026-01-01', 50000),
        contribution('2', '2026-02-01', 10000),
      ],
    }),
    '2026-10-06',
  );
  assert.equal(v.value, 60000);
  assert.equal(v.source, 'paid-in');
});

test('a statement value is the truth; later money in and out is added, and labelled an estimate', () => {
  const p = plan({
    entries: [
      contribution('1', '2026-01-01', 50000),
      contribution('2', '2026-08-01', 10000),
      redeem('3', '2026-09-01', 4000),
    ],
    valuations: [statement('v1', '2026-07-01', 55000)],
  });
  const v = planValue(p, '2026-10-06');
  assert.equal(v.value, 55000 + 10000 - 4000);
  assert.equal(v.source, 'estimate');
  assert.equal(planValue(p, '2026-07-01').value, 55000);
  assert.equal(planValue(p, '2026-07-01').source, 'statement');
});

test('gains stay in the plan and redeemed cash is not a loss', () => {
  const p = plan({
    entries: [
      contribution('1', '2026-01-01', 100000),
      redeem('2', '2026-06-01', 20000),
    ],
    valuations: [statement('v1', '2026-10-01', 90000)],
  });
  const v = planValue(p, '2026-10-06');
  assert.equal(v.contributed, 100000);
  assert.equal(v.redeemed, 20000);
  assert.equal(v.cost, 80000);
  assert.equal(v.gain, 10000); // 90,000 + 20,000 redeemed - 100,000 paid in
  assert.deepEqual(
    planFlows(p).map((f) => f.amount),
    [100000, -20000],
  );
});

test('an assumed yearly return grows the last statement value', () => {
  const p = plan({
    assumedAnnualRate: 0.1,
    valuations: [statement('v1', '2025-10-06', 100000)],
  });
  const v = planValue(p, '2026-10-06');
  assert.ok(Math.abs(v.value - 110000) < 1);
  assert.equal(v.source, 'estimate');
});

test('a closed plan is worth nothing but keeps its history', () => {
  const p = plan({
    closed: true,
    entries: [
      contribution('1', '2026-01-01', 50000),
      redeem('2', '2026-09-01', 52000),
    ],
    valuations: [statement('v', '2026-08-01', 51000)],
  });
  const v = planValue(p, '2026-10-06');
  assert.equal(v.value, 0);
  assert.equal(v.gain, 2000);
});

test('monthly contributions come due until confirmed or skipped', () => {
  const rule = {
    id: 'r1',
    dayOfMonth: 5,
    amount: 20000,
    from: '2026-07',
    skipped: ['2026-08'],
  };
  const p = plan({
    rules: [rule],
    entries: [contribution('c', '2026-07-05', 20000, { recurringId: 'r1' })],
  });
  assert.deepEqual(
    dueEntries(p, '2026-10-06').map((d) => d.date),
    ['2026-09-05', '2026-10-05'],
  );
  assert.deepEqual(
    dueEntries(p, '2026-10-04').map((d) => d.date),
    ['2026-09-05'],
  );
  assert.deepEqual(dueEntries({ ...p, closed: true }, '2026-10-06'), []);
  assert.deepEqual(
    dueEntries({ ...p, rules: [{ ...rule, stopped: true }] }, '2026-10-06'),
    [],
  );
});

test('validation rejects future dates, zero amounts and redeeming more than was paid in without a statement', () => {
  const today = '2026-10-06';
  assert.doesNotThrow(() =>
    validatePlan(
      plan({ entries: [contribution('1', '2026-01-01', 1)] }),
      today,
    ),
  );
  assert.throws(
    () =>
      validatePlan(
        plan({ entries: [contribution('1', '2027-01-01', 1)] }),
        today,
      ),
    /future/,
  );
  assert.throws(
    () =>
      validatePlan(
        plan({ entries: [contribution('1', '2026-01-01', 0)] }),
        today,
      ),
    /greater than zero/,
  );
  assert.throws(
    () =>
      validatePlan(
        plan({
          entries: [
            contribution('1', '2026-01-01', 10),
            redeem('2', '2026-02-01', 50),
          ],
        }),
        today,
      ),
    /redeemed/,
  );
  assert.doesNotThrow(() =>
    validatePlan(
      plan({
        entries: [
          contribution('1', '2026-01-01', 10),
          redeem('2', '2026-02-01', 50),
        ],
        valuations: [statement('v', '2026-01-15', 100)],
      }),
      today,
    ),
  );
  assert.throws(
    () =>
      validatePlan(
        plan({
          rules: [
            {
              id: 'r',
              dayOfMonth: 31,
              amount: 1,
              from: '2026-01',
              skipped: [],
            },
          ],
        }),
        today,
      ),
    /1 to 28/,
  );
  assert.throws(
    () => validateAssets([plan({ provider: 'x' })], today),
    /provider/,
  );
});

test('plans join the All dashboard as their own class and count in the combined return', () => {
  const p = plan({
    entries: [contribution('1', '2025-01-01', 100000)],
    valuations: [statement('v', '2026-10-01', 112000)],
  });
  const ledger = { ...blankPortfolio(), assets: [p] };
  const o = accountOverview(
    [{ id: 'a', name: 'Savings', portfolio: ledger }],
    '2026-10-06',
  );
  assert.deepEqual(
    o.classes.map((c) => c.key),
    ['plans'],
  );
  assert.equal(o.total.value, 112000);
  assert.equal(o.total.gain, 12000);
  assert.equal(valueAsset(p, [], '2026-10-06').estimated, false);
  assert.ok(o.returns.rate > 0);
});

test('a front-end load is not invested: the estimate grows from amount less load, paid-in stays gross', () => {
  const p = plan({
    entries: [contribution('1', '2026-01-05', 100000, { load: 3000 })],
  });
  const v = planValue(p, '2026-02-01');
  assert.equal(v.value, 97000);
  assert.equal(v.cost, 100000);
  assert.equal(v.gain, -3000);
  assert.throws(
    () =>
      validatePlan(
        plan({
          entries: [contribution('1', '2026-01-05', 1000, { load: 1000 })],
        }),
        '2026-10-06',
      ),
    /load/,
  );
});
