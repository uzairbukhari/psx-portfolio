import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fundFlows,
  fundPosition,
  validateFund,
  valueFund,
} from '../lib/funds.ts';
import {
  latestNavs,
  mufapDate,
  parseMufapNavs,
  redemptionPrice,
} from '../lib/mufap.ts';
import { dueEntries } from '../lib/plans.ts';
import { validateAssets, valueAsset } from '../lib/assets.ts';
import { accountOverview } from '../lib/account-overview.ts';
import { blankPortfolio } from '../lib/portfolio.ts';

const fund = (over = {}) => ({
  id: 'f1',
  kind: 'fund',
  name: 'Meezan Rozana Amdani',
  mufapId: '14750',
  amc: 'Al Meezan',
  fundName: 'Meezan Rozana Amdani Fund',
  category: 'Shariah Compliant Money Market',
  note: '',
  entries: [],
  manualNavs: [],
  rules: [],
  ...over,
});
const e = (id, type, date, units, amount, extra = {}) => ({
  id,
  type,
  date,
  units,
  amount,
  note: '',
  ...extra,
});
const nav = (date, navValue, repurchase = navValue, mufapId = '14750') => ({
  mufapId,
  date,
  nav: navValue,
  offer: navValue * 1.01,
  repurchase,
});

const row = (id, name, cells) =>
  `<tr><td>${cells[0]}</td><td>${cells[1]}</td><td><a href="/FundProfile/FundDetail?FundID=${id}">${name}</a></td><td>${cells[2]}</td><td>${cells[3]}</td><td>${cells[4]}</td><td>${cells[5]}</td><td>${cells[6]}</td><td>${cells[7]}</td></tr>`;
const PAGE = `<table><thead><tr><th>Sector</th></tr></thead><tbody>
${row('14750', '786 Islamic Money Market Fund', ['Open-End Funds', '786 Investments Limited', 'Shariah Compliant Money Market', 'Oct 22, 2024', '104.1946', '103.1630', '103.1630', 'Oct 05, 2026'])}
${row('15195', 'ABL GOB Islamic Pension Fund', ['Employer Pension Funds', 'ABL Asset Management Company Limited', 'VPS-Shariah Compliant Money Market', 'Jul 27, 2026', '0.0000', '101.3030', '101.3030', 'Oct 05, 2026'])}
<tr><td>broken</td></tr>
${row('99999', 'No price', ['Open-End Funds', 'X', 'Income', 'Jan 01, 2020', '0', '0', '0', 'Oct 05, 2026'])}
</tbody></table>`;

test('the MUFAP table parser reads funds and prices and skips rows it cannot trust', () => {
  const { catalog, navs } = parseMufapNavs(PAGE);
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog[0], {
    mufapId: '14750',
    amc: '786 Investments Limited',
    fundName: '786 Islamic Money Market Fund',
    category: 'Shariah Compliant Money Market',
    sector: 'Open-End Funds',
    inceptionDate: '2024-10-22',
  });
  assert.deepEqual(navs[1], {
    mufapId: '15195',
    date: '2026-10-05',
    nav: 101.303,
    offer: 0,
    repurchase: 101.303,
  });
  assert.equal(mufapDate('Oct 05, 2026'), '2026-10-05');
  assert.equal(mufapDate('nonsense'), null);
  assert.equal(redemptionPrice({ nav: 100, repurchase: 0 }), 100);
  assert.equal(
    latestNavs(
      [nav('2026-10-01', 1), nav('2026-10-05', 2), nav('2026-10-09', 3)],
      '2026-10-06',
    ).get('14750').nav,
    2,
  );
});

test('redeeming removes units at average cost and records the gain; history is kept', () => {
  const f = fund({
    entries: [
      e('1', 'buy', '2026-01-01', 100, 10000),
      e('2', 'buy', '2026-02-01', 100, 11000),
      e('3', 'redeem', '2026-03-01', 50, 6000),
    ],
  });
  const p = fundPosition(f);
  assert.equal(p.units, 150);
  assert.equal(p.cost, 15750); // 21000 - 50 * 105
  assert.equal(p.realized, 750);
  assert.deepEqual(
    p.history.map((h) => h.heldAfter),
    [100, 200, 150],
  );
  assert.throws(
    () =>
      fundPosition(
        fund({
          entries: [
            e('1', 'buy', '2026-01-01', 1, 1),
            e('2', 'redeem', '2026-02-01', 2, 1),
          ],
        }),
      ),
    /exceeds/,
  );
});

test('dividends are income, reinvested dividends add units without cash, and flows follow the cash', () => {
  const f = fund({
    entries: [
      e('1', 'buy', '2026-01-01', 100, 10000),
      e('2', 'dividend', '2026-04-01', undefined, 500),
      e('3', 'reinvest', '2026-04-02', 5, 500),
      e('4', 'redeem', '2026-06-01', 10, 1100),
    ],
  });
  const p = fundPosition(f);
  assert.equal(p.dividends, 500);
  assert.equal(p.units, 95);
  assert.deepEqual(
    fundFlows(f).map((x) => x.amount),
    [10000, -500, -1100],
  );
});

test('value uses the redemption price; a newer price you entered wins; no price is not zero', () => {
  const f = fund({ entries: [e('1', 'buy', '2026-01-01', 100, 10000)] });
  const navs = [nav('2026-10-05', 103, 102)];
  assert.equal(valueFund(f, navs, '2026-10-06').value, 10200);
  assert.equal(valueFund(f, navs, '2026-10-06').price.source, 'mufap');
  const manual = fund({
    entries: f.entries,
    manualNavs: [{ id: 'm1', date: '2026-10-06', nav: 110 }],
  });
  assert.equal(valueFund(manual, navs, '2026-10-06').value, 11000);
  assert.equal(valueFund(f, [], '2026-10-06').value, null);
  assert.equal(valueAsset(f, [], '2026-10-06', navs).classKey, 'funds');
});

test('monthly fund purchases come due like plan contributions', () => {
  const f = fund({
    rules: [
      { id: 'r', dayOfMonth: 1, amount: 25000, from: '2026-08', skipped: [] },
    ],
    entries: [e('1', 'buy', '2026-08-01', 10, 25000, { recurringId: 'r' })],
  });
  assert.deepEqual(
    dueEntries(f, '2026-10-06').map((d) => d.date),
    ['2026-09-01', '2026-10-01'],
  );
});

test('validation needs a fund from the list, real units and amounts', () => {
  const today = '2026-10-06';
  assert.doesNotThrow(() =>
    validateAssets(
      [fund({ entries: [e('1', 'buy', '2026-01-01', 10, 1000)] })],
      today,
    ),
  );
  assert.throws(
    () => validateFund(fund({ mufapId: '' }), today),
    /fund from the list/,
  );
  assert.throws(
    () =>
      validateFund(
        fund({ entries: [e('1', 'buy', '2026-01-01', 0, 1000)] }),
        today,
      ),
    /units/,
  );
  assert.throws(
    () =>
      validateFund(
        fund({ entries: [e('1', 'buy', '2027-01-01', 1, 1000)] }),
        today,
      ),
    /future/,
  );
});

test('funds join the All dashboard as their own class', () => {
  const ledger = {
    ...blankPortfolio(),
    assets: [fund({ entries: [e('1', 'buy', '2025-01-01', 100, 10000)] })],
  };
  const o = accountOverview(
    [{ id: 'a', name: 'Funds', portfolio: ledger }],
    '2026-10-06',
    { fundNavs: [nav('2026-10-05', 120)] },
  );
  assert.deepEqual(
    o.classes.map((c) => c.key),
    ['funds'],
  );
  assert.equal(o.total.value, 12000);
  assert.equal(o.total.gain, 2000);
  const missing = accountOverview(
    [{ id: 'a', name: 'Funds', portfolio: ledger }],
    '2026-10-06',
  );
  assert.ok(missing.total.incomplete.some((m) => /fund price/.test(m)));
});

test('a fund load stays inside the amount paid and must be smaller than it', () => {
  const today = '2026-10-06';
  const ok = fund({
    entries: [e('1', 'buy', '2026-01-01', 10, 1000, { load: 30 })],
  });
  validateFund(ok, today);
  const v = valueFund(ok, [nav('2026-01-02', 100)], '2026-01-02');
  assert.equal(v.cost, 1000);
  assert.throws(
    () =>
      validateFund(
        fund({
          entries: [e('1', 'buy', '2026-01-01', 10, 1000, { load: 1000 })],
        }),
        today,
      ),
    /load/,
  );
});
