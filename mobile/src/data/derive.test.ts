import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio } from '../../../lib/portfolio.ts';
import { companyDividends, activeNotifications, activityEntries, formatPercent, openPositions, priceTickers, readOnlyReason, safeHoldings, totals } from './derive.ts';

function sample() {
  const p = blankPortfolio();
  p.companies = [
    { ticker: 'AAA', name: 'Alpha', sector: 'Bank', target: 0, approved: true, screenDate: '2026-01-01', note: '' },
    { ticker: 'BBB', name: 'Beta', sector: 'Bank', target: 0, approved: true, screenDate: '2026-01-01', note: '' },
    { ticker: 'CCC', name: 'Gamma', sector: 'Bank', target: 0, approved: true, screenDate: '2026-01-01', note: '' },
  ];
  p.trades = [
    { id: 't1', ticker: 'AAA', kind: 'buy', date: '2026-02-01', shares: 10, price: 100, fees: 0, month: '2026-02', note: '' },
    { id: 't2', ticker: 'BBB', kind: 'buy', date: '2026-02-02', shares: 5, price: 200, fees: 0, month: '2026-02', note: '' },
    { id: 't3', ticker: 'CCC', kind: 'buy', date: '2026-02-03', shares: 1, price: 50, fees: 0, month: '2026-02', note: '' },
    { id: 't4', ticker: 'CCC', kind: 'sell', date: '2026-03-01', shares: 1, price: 60, fees: 0, month: '2026-03', note: '', voided: false },
  ];
  p.quotes = { AAA: { price: 120, asOf: '', date: '2026-03-05', source: '', fetchedAt: '' } };
  return p;
}

test('totals use the shared summary: priced value, gain only when complete', () => {
  const { held } = safeHoldings(sample());
  const t = totals(held);
  assert.equal(t.value, 1200, 'BBB has no price and adds nothing');
  assert.equal(t.cost, 1000 + 1000, 'cost of all open positions is known');
  assert.equal(t.gain, null, 'BBB is unpriced, so no gain is reported');
  assert.equal(t.gainPercent, null);
  assert.deepEqual(t.missingPrice, ['BBB']);
  assert.deepEqual(t.incomplete, ['missing-price']);
  assert.equal(t.oldestQuoteDate, '2026-03-05');
});

test('totals report gain once every open position is priced', () => {
  const p = sample();
  p.quotes.BBB = { price: 210, asOf: '', date: '2026-03-06', source: '', fetchedAt: '' };
  const t = totals(safeHoldings(p).held);
  assert.deepEqual([t.value, t.cost, t.gain], [2250, 2000, 250]);
  assert.equal(t.gainPercent, 12.5);
  assert.deepEqual(t.incomplete, []);
});

test('openPositions hides sold-out companies and puts priced ones first', () => {
  const { held } = safeHoldings(sample());
  assert.deepEqual(openPositions(held).map((h) => h.ticker), ['AAA', 'BBB']);
});

test('safeHoldings reports an oversold ledger instead of throwing', () => {
  const p = sample();
  p.trades.push({ id: 'x', ticker: 'AAA', kind: 'sell', date: '2026-04-01', shares: 999, price: 1, fees: 0, month: '2026-04', note: '' });
  const r = safeHoldings(p);
  assert.match(r.error ?? '', /exceeds shares held/);
  assert.deepEqual(r.held, []);
});

test('activity is newest first, can filter by ticker, and skips voided entries', () => {
  const p = sample();
  p.trades[0].voided = true;
  const all = activityEntries(p);
  assert.deepEqual(all.map((e) => e.id), ['t4', 't3', 't2']);
  assert.deepEqual(activityEntries(p, 'CCC').map((e) => e.id), ['t4', 't3']);
});

test('dividends and splits join the activity list', () => {
  const p = sample();
  p.dividends = [{ id: 'd1', ticker: 'AAA', date: '2026-03-10', source: 'manual', netAmount: 85, perShare: 10, note: '' }];
  p.stockSplits = [{ id: 's1', ticker: 'AAA', date: '2026-03-20', oldShares: 1, newShares: 2, note: '' }];
  const kinds = activityEntries(p, 'AAA').map((e) => e.kind);
  assert.deepEqual(kinds, ['split', 'dividend', 'buy']);
});

test('cleared notifications are hidden', () => {
  const p = sample();
  p.notifications = [
    { id: 'a', at: '2026-03-01T00:00:00Z', kind: 'info', title: 'a', body: '', read: false },
    { id: 'b', at: '2026-03-02T00:00:00Z', kind: 'info', title: 'b', body: '', read: false, clearedAt: '2026-03-03T00:00:00Z' },
  ];
  assert.deepEqual(activeNotifications(p).map((n) => n.id), ['a']);
});

test('formatPercent signs and handles null', () => {
  assert.equal(formatPercent(12.345), '+12.35%');
  assert.equal(formatPercent(-1), '-1.00%');
  assert.equal(formatPercent(null), '—');
});

test('priceTickers covers held, targeted and shortlisted companies once each', () => {
  const p = sample();
  p.companies.push({ ticker: 'DDD', name: 'Delta', sector: 'Bank', target: 20, approved: true, screenDate: '2026-01-01', note: '' });
  p.companies.push({ ticker: 'EEE', name: 'Echo', sector: 'Bank', target: 0, approved: true, screenDate: '2026-01-01', note: '' });
  p.monthlyPicksShortlist = ['EEE', 'AAA', 'ZZZ'];
  // CCC is sold out and untargeted; ZZZ is not a company in the portfolio.
  assert.deepEqual(priceTickers(p).sort(), ['AAA', 'BBB', 'DDD', 'EEE']);
  assert.deepEqual(priceTickers(p, ['CCC', 'AAA']).sort(), ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
});

test('readOnlyReason refuses imported, automatic and voided entries but not hand-entered ones', () => {
  const p = sample();
  p.trades.push({ id: 'imp', ticker: 'AAA', kind: 'buy', date: '2026-03-02', shares: 1, price: 1, fees: 0, month: '', note: '', source: 'ahl' } as never);
  p.trades.push({ id: 'man', ticker: 'AAA', kind: 'buy', date: '2026-03-03', shares: 1, price: 1, fees: 0, month: '', note: '', source: 'manual' } as never);
  p.trades[0].voided = true;
  p.dividends = [
    { id: 'auto', ticker: 'AAA', date: '2026-03-10', source: 'auto', perShare: 1, note: '' },
    { id: 'hand', ticker: 'AAA', date: '2026-03-11', source: 'manual', perShare: 1, note: '' },
  ] as never;
  assert.match(readOnlyReason(p, 'imp') ?? '', /Imported entries can't be edited/);
  assert.match(readOnlyReason(p, 'auto') ?? '', /Automatic and imported dividends/);
  assert.match(readOnlyReason(p, 't1') ?? '', /Voided/);
  assert.equal(readOnlyReason(p, 'man'), null);
  assert.equal(readOnlyReason(p, 't2'), null, 'legacy entries without a source stay editable');
  assert.equal(readOnlyReason(p, 'hand'), null);
  assert.equal(readOnlyReason(p, 'missing'), null);
});

test('companyDividends lists a company\'s expected and received dividends newest first', () => {
  const p = sample();
  p.dividends = [
    { id: 'm1', ticker: 'AAA', date: '2026-01-15', source: 'manual', perShare: 2, grossAmount: 20, note: '' },
    { id: 'a1', ticker: 'AAA', date: '2026-03-10', source: 'auto', status: 'expected', entitlementDate: '2026-03-09', perShare: 5, grossAmount: 50, externalId: 'x', note: '' },
    { id: 'a2', ticker: 'AAA', date: '2026-02-10', source: 'auto', status: 'received', paymentDate: '2026-02-20', taxWithheld: 7.5, perShare: 5, grossAmount: 50, externalId: 'y', note: '' },
    { id: 'v1', ticker: 'AAA', date: '2026-04-01', source: 'manual', perShare: 1, grossAmount: 10, note: '', voided: true },
    { id: 'o1', ticker: 'BBB', date: '2026-03-01', source: 'manual', perShare: 1, grossAmount: 5, note: '' },
  ];
  const rows = companyDividends(p, 'AAA');
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [['a1', 'expected'], ['a2', 'received'], ['m1', 'received']]);
  const expected = rows[0];
  assert.deepEqual([expected.gross, expected.perShare, expected.entitlementDate, expected.paymentDate], [50, 5, '2026-03-09', null]);
  const received = rows[1];
  assert.deepEqual([received.paymentDate, received.tax, received.taxIsActual, received.net], ['2026-02-20', 7.5, true, 42.5]);
  assert.deepEqual(companyDividends(p, 'CCC'), []);
  assert.deepEqual(companyDividends(blankPortfolio(), 'AAA'), []);
});
