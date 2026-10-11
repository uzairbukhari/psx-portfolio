import test from 'node:test';
import assert from 'node:assert/strict';
import { planFundPayouts, undoFundPayoutBatch } from '../lib/fund-payouts.ts';
import { fundPosition, validateFund } from '../lib/funds.ts';

const e = (id, type, date, units, amount, extra = {}) => ({ id, type, date, units, amount, note: '', ...extra });
const fund = (entries, over = {}) => ({
  id: 'f1', kind: 'fund', name: 'Al Ameen Islamic Cash Fund', mufapId: '13146', amc: 'UBL', fundName: 'Al Ameen Islamic Cash Fund',
  category: 'Shariah Compliant Money Market', note: '', entries, manualNavs: [], rules: [], ...over,
});
const payout = (date, perUnit = 9.3, exNav = 101, mufapId = '13146') => ({ mufapId, payoutDate: date, perUnit, exNav });
const base = () => [e('b1', 'buy', '2026-05-04', 9.121, 1000), e('b2', 'buy', '2026-07-01', 49.2475, 5000)];

test('reinvests only the units held before the payout, at the ex-NAV, after tax', () => {
  const plan = planFundPayouts(fund(base()), [payout('2026-06-29')], '2026-10-12', 'b');
  assert.equal(plan.added, 1);
  const r = plan.entries.find((x) => x.source === 'auto');
  assert.equal(r.type, 'reinvest');
  assert.equal(r.date, '2026-06-29');
  assert.equal(r.amount, 72.1); // 9.121 x 9.3 x 0.85
  assert.equal(r.units, 0.7139); // 72.10 / 101
  assert.equal(r.estimated, true);
  assert.equal(fundPosition({ ...fund(base()), entries: plan.entries }).units, 59.0824);
});

test('is idempotent, skips voided and hand-entered payouts, and honours cash mode', () => {
  const once = planFundPayouts(fund(base()), [payout('2026-06-29')], '2026-10-12', 'b');
  assert.equal(planFundPayouts(fund(once.entries), [payout('2026-06-29')], '2026-10-12', 'c'), null);
  const voided = once.entries.map((x) => (x.source === 'auto' ? { ...x, voided: true } : x));
  assert.equal(planFundPayouts(fund(voided), [payout('2026-06-29')], '2026-10-12', 'c'), null);
  const manual = [...base(), e('m', 'reinvest', '2026-06-30', 0.84, 88)];
  assert.equal(planFundPayouts(fund(manual), [payout('2026-06-29')], '2026-10-12', 'c'), null);
  const cash = planFundPayouts(fund(base(), { payoutMode: 'cash' }), [payout('2026-06-29')], '2026-10-12', 'b');
  const c = cash.entries.find((x) => x.source === 'auto');
  assert.equal(c.type, 'dividend');
  assert.equal(c.units, undefined);
});

test('skips payouts before the first unit, in the future and for other funds; recalculates estimates', () => {
  const early = [payout('2026-04-01'), payout('2026-12-01'), payout('2026-06-29', 9.3, 101, '999')];
  assert.equal(planFundPayouts(fund(base()), early, '2026-10-12', 'b'), null);
  const once = planFundPayouts(fund(base()), [payout('2026-06-29')], '2026-10-12', 'b');
  const richer = [e('b0', 'buy', '2026-05-01', 10, 1000), ...once.entries];
  const again = planFundPayouts(fund(richer), [payout('2026-06-29')], '2026-10-12', 'c');
  assert.equal(again.updated, 1);
  assert.ok(again.entries.find((x) => x.source === 'auto').units > 0.7139);
});

test('auto entries validate and one batch can be undone', () => {
  const plan = planFundPayouts(fund(base()), [payout('2026-06-29')], '2026-10-12', 'b');
  const f = fund(plan.entries);
  validateFund(f, '2026-10-12');
  assert.equal(undoFundPayoutBatch([f], 'b'), 1);
  assert.equal(f.entries.filter((x) => x.voided).length, 1);
});
