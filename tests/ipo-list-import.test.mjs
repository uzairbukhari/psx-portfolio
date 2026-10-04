import test from 'node:test';
import assert from 'node:assert/strict';
import { applyIpoListPlan, ipoPlanIsNoop, parseIpoList, planIpoListImport } from '../lib/ipo-list-import.ts';
import { blankPortfolio, holdings, validate } from '../lib/portfolio.ts';

const row = (over) => ({
  subscriptionAppId: '1', securityName: 'TEST LIMITED', subscriptionEndDate: '12-MAY-2026', issueNumber: '2026-1',
  noOfSecuritiesSuccessful: '1,500', amountPayableOrPaid: '28,350.00', offerTypeValue: 'New Offer', securitySymbol: 'AAA',
  numberOfSecuritiesApplied: '1,500', subscriptionStartDate: '11-MAY-2026', refundAmount: '0.00', status: 'Allotted (Demat)', ...over,
});
const file = (rows) => ({ data: rows, message: 'Data Found', dataCount: rows.length, status: 'success' });
const sample = () => file([
  row({}),
  row({ subscriptionAppId: '2', securitySymbol: 'BBB', noOfSecuritiesSuccessful: '1,078', numberOfSecuritiesApplied: '2,500', amountPayableOrPaid: '25,025.00', refundAmount: '14,245.00', subscriptionEndDate: '18-SEP-2025' }),
  row({ subscriptionAppId: '3', securitySymbol: 'CCC ', noOfSecuritiesSuccessful: '500', numberOfSecuritiesApplied: '500', amountPayableOrPaid: '9,100.00' }),
  row({ subscriptionAppId: '4', securitySymbol: 'DDD', noOfSecuritiesSuccessful: '0', amountPayableOrPaid: '0', refundAmount: '30,000.00', status: 'Not Successful' }),
  row({ subscriptionAppId: '5', securitySymbol: 'EEE', noOfSecuritiesSuccessful: '0', status: 'Under Process' }),
  row({ subscriptionAppId: '6', securitySymbol: 'FFF', status: 'Partial Successful', amountPayableOrPaid: '16,050.00', offerTypeValue: 'Offer for Sale' }),
]);

test('parses commas, trims symbols and checks the declared count', () => {
  const items = parseIpoList(sample());
  assert.equal(items.length, 6);
  assert.equal(items[2].ticker, 'CCC');
  assert.equal(items[1].allotted, 1078);
  assert.equal(items[0].endDate, '2026-05-12');
  assert.throws(() => parseIpoList({ ...sample(), dataCount: 9 }), /9 subscriptions/);
  assert.throws(() => parseIpoList({ nothing: true }));
});

test('price is what was paid after refund per allotted share; unallotted and pending rows add nothing', () => {
  const plan = planIpoListImport(blankPortfolio(), parseIpoList(sample()));
  const by = Object.fromEntries(plan.rows.map((r) => [r.item.ticker, r]));
  assert.equal(by.AAA.price, 18.9);
  assert.equal(by.BBB.price, 10, '(25,025 - 14,245) / 1,078');
  assert.equal(by.CCC.price, 18.2);
  assert.equal(by.DDD.status, 'not-allotted');
  assert.equal(by.EEE.status, 'pending');
  assert.equal(plan.counts.imported, 4);
  assert.equal(plan.counts.skipped, 2);
  assert.ok(by.FFF.flags.some((f) => /Marked partial/.test(f)), 'partial with everything received is flagged');
  const next = applyIpoListPlan(blankPortfolio(), plan);
  validate(next);
  assert.equal(holdings(next).find((h) => h.ticker === 'BBB').shares, 1078);
  assert.ok(next.companies.every((c) => !c.approved && c.target === 0));
  assert.equal(next.trades[0].dateCertainty, 'inferred');
});

test('re-importing the same file is a no-op', () => {
  const items = parseIpoList(sample());
  const first = applyIpoListPlan(blankPortfolio(), planIpoListImport(blankPortfolio(), items));
  const again = planIpoListImport(first, items);
  assert.equal(again.counts.duplicate, 4);
  assert.ok(ipoPlanIsNoop(again));
});

test('a real allotment replaces an assumed acquisition from an earlier import', () => {
  const p = blankPortfolio();
  p.companies.push({ ticker: 'AAA', name: 'AAA', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({
    id: 'inf1', ticker: 'AAA', kind: 'buy', date: '2026-05-12', shares: 1500, price: 10, fees: 0, month: '', note: 'assumed', source: 'ahl',
    externalId: 'ahl:inferred:AAA:x', inferred: { basis: 'sale-price-fallback', priceSource: 's', dateBasis: 'day-before-sale', forSale: 'sale1', label: 'l' },
  });
  p.trades.push({ id: 'sell1', ticker: 'AAA', kind: 'sell', date: '2026-06-30', shares: 1500, price: 21, fees: 0, month: '', note: '' });
  const plan = planIpoListImport(p, parseIpoList(file([row({})])));
  assert.deepEqual(plan.rows[0].supersedes, [{ id: 'inf1', shares: 1500 }]);
  const next = applyIpoListPlan(p, plan);
  const old = next.trades.find((t) => t.id === 'inf1');
  assert.equal(old.voided, true);
  assert.equal(old.supersededBy, 'ipo-b-1');
  validate(next);
});

test('a manual buy of the same quantity near the date needs a decision', () => {
  const p = blankPortfolio();
  p.companies.push({ ticker: 'AAA', name: 'AAA', sector: '', target: 0, approved: false, screenDate: '', note: '' });
  p.trades.push({ id: 'm1', ticker: 'AAA', kind: 'buy', date: '2026-05-15', shares: 1500, price: 18.9, fees: 0, month: '2026-05', note: '' });
  const plan = planIpoListImport(p, parseIpoList(file([row({})])));
  assert.equal(plan.rows[0].status, 'ambiguous');
  assert.ok(plan.blockers.length);
  const decided = planIpoListImport(p, parseIpoList(file([row({})])), { resolutions: { 'ipo:1': { action: 'skip' } } });
  assert.equal(decided.blockers.length, 0);
});

test('official allotment date from hand-checked evidence replaces the end date', () => {
  const ipo = { AAA: { status: 'found', ticker: 'AAA', offerPrice: 18.9, allotmentDate: '2026-05-20', evidence: [], verification: 'curated', checkedAt: 'x' } };
  const plan = planIpoListImport(blankPortfolio(), parseIpoList(file([row({})])), { ipo });
  assert.equal(plan.rows[0].date, '2026-05-20');
  assert.equal(plan.rows[0].dateInferred, false);
});
