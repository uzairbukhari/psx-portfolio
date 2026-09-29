import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, taxSummary, entitlementDate, pendingAutoDividends, holdings } from '../lib/portfolio.ts';

const ASOF = '2026-01-01';
const company = (extra = {}) => ({ ticker: 'MEBL', name: 'Meezan', target: 0, approved: true, screenDate: '', note: '', ...extra });
const buy = (id, date, shares) => ({ id, ticker: 'MEBL', kind: 'buy', date, shares, price: 100, fees: 0, month: date.slice(0, 7), note: '' });
const portfolio = (trades, extra = {}) => ({
  companies: [company()], trades, quotes: {}, budgets: {}, taxProfile: { filerStatus: 'filer' }, ...extra,
});
const ann = (extra = {}) => ({
  ticker: 'MEBL', announcedOn: '2025-08-13', period: '30/06/2025(HYR)', details: '70%(ii) (D)', kind: 'cash',
  percent: 70, perShareRs: null, bookClosureStart: '2025-08-27', bookClosureEnd: '2025-08-28', ...extra,
});

test('entitlement date is two weekdays before book closure start', () => {
  assert.equal(entitlementDate('2025-08-27'), '2025-08-25'); // Wed -> Mon
  assert.equal(entitlementDate('2025-08-26'), '2025-08-22'); // Tue -> Fri
  assert.equal(entitlementDate('2025-08-25'), '2025-08-21'); // Mon -> Thu
});

test('cash dividend = percent x face value x shares held on entitlement date', () => {
  const p = portfolio([buy('1', '2025-01-02', 100)]);
  const [d] = pendingAutoDividends(p, [ann()], ASOF);
  assert.equal(d.source, 'auto');
  assert.equal(d.perShare, 7);
  assert.equal(d.grossAmount, 700);
  assert.equal(d.date, '2025-08-27');
  assert.equal(d.externalId, 'psx:MEBL:2025-08-27:2025-08-13');
  p.dividends = [d];
  validate(p);
  const t = taxSummary(p).dividends[0];
  assert.equal(t.tax, 105);
  assert.equal(t.netAmount, 595);
});

test('shares bought on or after the settlement cutoff earn nothing', () => {
  const late = portfolio([buy('1', '2025-01-02', 100), buy('2', '2025-08-26', 50)]);
  assert.equal(pendingAutoDividends(late, [ann()], ASOF)[0].grossAmount, 700);
  const onCutoff = portfolio([buy('1', '2025-08-25', 10)]);
  assert.equal(pendingAutoDividends(onCutoff, [ann()], ASOF)[0].grossAmount, 70);
  assert.deepEqual(pendingAutoDividends(portfolio([buy('1', '2025-08-26', 10)]), [ann()], ASOF), []);
});

test('sold-out holdings and future book closures are skipped', () => {
  const sold = portfolio([buy('1', '2025-01-02', 10), { ...buy('2', '2025-08-01', 10), kind: 'sell' }]);
  assert.deepEqual(pendingAutoDividends(sold, [ann()], ASOF), []);
  const p = portfolio([buy('1', '2025-01-02', 10)]);
  assert.deepEqual(pendingAutoDividends(p, [ann()], '2025-08-26'), []);
  assert.equal(pendingAutoDividends(p, [ann()], '2025-08-27').length, 1);
});

test('split-aware share count and face value override', () => {
  const p = portfolio([buy('1', '2025-01-02', 10)], {
    stockSplits: [{ id: 's', ticker: 'MEBL', date: '2025-06-01', oldShares: 1, newShares: 5, note: '' }],
  });
  p.companies[0].faceValue = 1;
  const [d] = pendingAutoDividends(p, [ann()], ASOF);
  assert.equal(d.perShare, 0.7);
  assert.equal(d.grossAmount, 35);
});

test('never re-adds recorded or voided entries and never doubles manual/CDC entries', () => {
  const p = portfolio([buy('1', '2025-01-02', 100)]);
  const [d] = pendingAutoDividends(p, [ann()], ASOF);
  p.dividends = [d];
  assert.deepEqual(pendingAutoDividends(p, [ann()], ASOF), []);
  p.dividends = [{ ...d, voided: true }];
  assert.deepEqual(pendingAutoDividends(p, [ann()], ASOF), []);
  p.dividends = [{ id: 'm', ticker: 'MEBL', date: '2025-09-10', source: 'manual', perShare: 7, grossAmount: 700, note: '' }];
  assert.deepEqual(pendingAutoDividends(p, [ann()], ASOF), []);
  p.dividends = [{ id: 'm', ticker: 'MEBL', date: '2025-12-30', source: 'manual', perShare: 7, grossAmount: 700, note: '' }];
  assert.equal(pendingAutoDividends(p, [ann()], ASOF).length, 1, 'a much later dividend does not suppress it');
});

test('bonus, right, unknown ticker and Rs per-share rows', () => {
  const p = portfolio([buy('1', '2025-01-02', 100)]);
  assert.deepEqual(pendingAutoDividends(p, [ann({ kind: 'bonus' }), ann({ kind: 'right' }), ann({ ticker: 'LUCK' })], ASOF), []);
  const [d] = pendingAutoDividends(p, [ann({ percent: null, perShareRs: 2.5 })], ASOF);
  assert.equal(d.grossAmount, 250);
});

test('two announcements sharing a book closure both count', () => {
  const p = portfolio([buy('1', '2025-01-02', 100)]);
  const rows = [ann(), ann({ announcedOn: '2025-08-20', percent: 30 })];
  const out = pendingAutoDividends(p, rows, ASOF);
  assert.equal(out.length, 2);
  p.dividends = out;
  validate(p);
});

test('validate rejects malformed auto dividends and bad face values', () => {
  const p = portfolio([buy('1', '2025-01-02', 100)]);
  const [d] = pendingAutoDividends(p, [ann()], ASOF);
  for (const bad of [{ ...d, externalId: undefined }, { ...d, perShare: -1 }, { ...d, netAmount: 1 }, { ...d, ticker: 'NOPE' }]) {
    p.dividends = [bad];
    assert.throws(() => validate(p));
  }
  p.dividends = [d, { ...d, id: 'other' }];
  assert.throws(() => validate(p), /Duplicate/);
  p.dividends = [d];
  p.companies[0].faceValue = 0;
  assert.throws(() => validate(p));
  const none = portfolio([buy('1', '2025-08-26', 10)]);
  none.dividends = [d];
  assert.throws(() => validate(none), /no shares held/);
  assert.equal(holdings(portfolio([buy('1', '2025-01-02', 1)])).length, 1);
});
