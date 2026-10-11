import test from 'node:test';
import assert from 'node:assert/strict';
import { matchStatement } from '../lib/fund-match.ts';
import { planFundPayouts } from '../lib/fund-payouts.ts';
import { fundPosition, validateFund } from '../lib/funds.ts';

const e = (id, type, date, units, amount, extra = {}) => ({
  id,
  type,
  date,
  units,
  amount,
  note: '',
  ...extra,
});
const fund = (entries, over = {}) => ({
  id: 'f1',
  kind: 'fund',
  name: 'Al Ameen',
  mufapId: '13146',
  amc: 'UBL',
  fundName: 'Al Ameen Islamic Cash Fund',
  category: 'Money Market',
  note: '',
  entries,
  manualNavs: [],
  rules: [],
  ...over,
});
const base = () => [
  e('b1', 'buy', '2026-05-04', 9.121, 1000),
  e('b2', 'buy', '2026-07-01', 49.2475, 5000),
];
const navs = [
  {
    mufapId: '13146',
    date: '2026-10-12',
    nav: 104.3031,
    offer: 104.3031,
    repurchase: 104.3031,
  },
];
const T = '2026-10-12';

test('your case: Rs 6,176 on the statement adds the missing 0.8437 units as one adjustment', () => {
  const r = matchStatement(
    fund(base()),
    navs,
    { date: T, value: 6176 },
    T,
    'match-1',
  );
  assert.ok(r.ok && r.changed);
  const adj = r.fund.entries.at(-1);
  assert.equal(adj.type, 'reinvest');
  assert.ok(Math.abs(adj.units - 0.8437) < 0.0006);
  validateFund(r.fund, T);
  assert.ok(Math.abs(fundPosition(r.fund).units * 104.3031 - 6176) < 0.6);
});

test('units are exact, and a matching ledger changes nothing', () => {
  const r = matchStatement(
    fund(base()),
    navs,
    { date: T, units: 59.2122 },
    T,
    'm',
  );
  assert.ok(
    r.ok && r.changed && Math.abs(fundPosition(r.fund).units - 59.2122) < 1e-9,
  );
  const same = matchStatement(
    fund(base()),
    navs,
    { date: T, units: 58.3685 },
    T,
    'm',
  );
  assert.ok(same.ok && !same.changed);
});

test('estimated payouts are scaled to fit, confirmed, and teach the tax rate', () => {
  const plan = planFundPayouts(
    fund(base()),
    [{ mufapId: '13146', payoutDate: '2026-06-29', perUnit: 10, exNav: 101 }],
    T,
    'b',
  );
  const f = fund(plan.entries);
  const r = matchStatement(f, navs, { date: T, units: 59.2122 }, T, 'm2');
  assert.ok(r.ok && r.changed);
  const auto = r.fund.entries.find((x) => x.source === 'auto');
  assert.equal(auto.estimated, false);
  assert.ok(Math.abs(fundPosition(r.fund).units - 59.2122) < 0.0002);
  assert.ok(r.fund.payoutTaxRate < 0.15);
  assert.equal(r.fund.entries.length, f.entries.length); // no extra adjustment entry
  // a later sync no longer touches the confirmed entry
  assert.equal(
    planFundPayouts(
      r.fund,
      [
        {
          mufapId: '13146',
          payoutDate: '2026-06-29',
          perUnit: 9.3,
          exNav: 101,
        },
      ],
      T,
      'c',
    ),
    null,
  );
});

test('fewer units than the ledger, no price, and future dates are explained, not applied', () => {
  assert.equal(
    matchStatement(fund(base()), navs, { date: T, units: 50 }, T, 'm').ok,
    false,
  );
  assert.equal(
    matchStatement(fund(base()), [], { date: T, value: 6176 }, T, 'm').ok,
    false,
  );
  assert.equal(
    matchStatement(
      fund(base()),
      navs,
      { date: '2026-12-01', units: 60 },
      T,
      'm',
    ).ok,
    false,
  );
});
