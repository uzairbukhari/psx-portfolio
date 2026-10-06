import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, holdings, validate } from '../../../lib/portfolio.ts';
import { changeNotifications, isIsoDate, markDividendReceived, parseNumber, recordDividend, recordSplit, recordTrade, setFilerStatus, voidEntry } from './mutations.ts';
import { clearOne } from '../../../lib/notification-actions.ts';
import { taxSummary } from '../../../lib/portfolio.ts';

function base() {
  const p = blankPortfolio();
  p.companies = [{ ticker: 'AAA', name: 'Alpha', sector: 'Bank', target: 0, approved: true, screenDate: '', note: '' }];
  return p;
}
const buy = (shares: number, price: number, date = '2026-02-01') => ({
  ticker: 'AAA', kind: 'buy' as const, date, shares, price, fees: 0, month: '', note: '',
});

test('recording a buy adds a trade and leaves the original untouched', () => {
  const p = base();
  const next = recordTrade(p, buy(10, 100));
  assert.equal(p.trades.length, 0);
  assert.equal(next.trades.length, 1);
  validate(next);
  assert.equal(holdings(next)[0].shares, 10);
});

test('editing voids the old line and inserts the correction right after it', () => {
  let p = recordTrade(base(), buy(10, 100));
  p = recordTrade(p, buy(5, 120, '2026-03-01'));
  const first = p.trades[0].id;
  const next = recordTrade(p, buy(12, 100), first);
  assert.equal(next.trades.length, 3);
  assert.equal(next.trades[0].voided, true);
  assert.equal(next.trades[1].shares, 12);
  validate(next);
  assert.equal(holdings(next)[0].shares, 17);
});

test('voiding removes an entry from holdings but keeps it in the ledger', () => {
  const p = recordTrade(base(), buy(10, 100));
  const next = voidEntry(p, 'trade', p.trades[0].id);
  assert.equal(next.trades.length, 1);
  assert.equal(holdings(next)[0].shares, 0);
});

test('an oversold ledger is rejected by validate', () => {
  const p = recordTrade(base(), buy(10, 100));
  const next = recordTrade(p, { ...buy(50, 100, '2026-03-01'), kind: 'sell' });
  assert.throws(() => validate(next), /exceeds shares held/);
});

test('unknown companies and stale edit ids are refused', () => {
  assert.throws(() => recordTrade(base(), { ...buy(1, 1), ticker: 'ZZZ' }), /Choose a company/);
  assert.throws(() => recordTrade(base(), buy(1, 1), 'missing'), /no longer exists/);
  assert.throws(() => voidEntry(base(), 'trade', 'missing'), /no longer exists/);
});

test('a dividend computes gross from shares held on its date and adds a notification', () => {
  const p = recordTrade(base(), buy(100, 50));
  const next = recordDividend(p, { ticker: 'AAA', date: '2026-04-01', perShare: 2.5, note: '' }, undefined, '2026-04-02T00:00:00Z');
  validate(next);
  assert.equal(next.dividends?.[0].grossAmount, 250);
  assert.equal(next.dividends?.[0].source, 'manual');
  assert.equal(next.notifications?.length, 1);
});

test('a split changes shares held', () => {
  const p = recordTrade(base(), buy(10, 100));
  const next = recordSplit(p, { ticker: 'AAA', date: '2026-03-01', oldShares: 1, newShares: 2, note: '' });
  validate(next);
  assert.equal(holdings(next)[0].shares, 20);
});

test('parseNumber and isIsoDate', () => {
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('28/02/2026'), false);
});

import { addCompany, isValidSymbol, setManualQuote } from './mutations.ts';

test('a manual quote is flagged manual and stored on the company', () => {
  const next = setManualQuote(base(), 'AAA', 123.4, '2026-05-01', '2026-05-01T10:00:00Z');
  assert.equal(next.quotes.AAA.price, 123.4);
  assert.equal(next.quotes.AAA.manual, true);
  assert.throws(() => setManualQuote(base(), 'ZZZ', 1, '2026-05-01'), /Choose a company/);
  assert.throws(() => setManualQuote(base(), 'AAA', 0, '2026-05-01'), /above zero/);
  assert.throws(() => setManualQuote(base(), 'AAA', 5, '2999-01-01'), /future/);
});

test('adding a company stores the confirmed quote and starts unapproved with no target', () => {
  const quote = { price: 10, asOf: 'x', date: '2026-05-01', source: 'https://dps.psx.com.pk/company/BBB', fetchedAt: 'f' };
  const next = addCompany(base(), { ticker: 'BBB', name: ' Beta Ltd ', sector: 'Bank' }, quote);
  validate(next);
  const c = next.companies.find((x) => x.ticker === 'BBB');
  assert.equal(c?.name, 'Beta Ltd');
  assert.equal(c?.approved, false);
  assert.equal(c?.target, 0);
  assert.equal(next.quotes.BBB.price, 10);
  assert.throws(() => addCompany(base(), { ticker: 'AAA', name: '', sector: 'Bank' }, quote), /already in your portfolio/);
  assert.throws(() => addCompany(base(), { ticker: 'a b', name: '', sector: 'Bank' }, quote), /valid PSX symbol/);
  assert.equal(isValidSymbol('MEBL'), true);
  assert.equal(isValidSymbol('x'), false);
});

function withExpected() {
  const p = recordTrade(base(), buy(100, 100, '2025-01-02'));
  p.dividends = [
    {
      id: 'auto-1', ticker: 'AAA', date: '2026-02-10', source: 'auto', status: 'expected', entitlementDate: '2026-02-09',
      perShare: 5, grossAmount: 500, externalId: 'psx:AAA:2026-02-10:2026-02-01', note: '',
    },
  ];
  return p;
}

test('markDividendReceived confirms with payment date, gross and tax, and leaves the input alone', () => {
  const p = withExpected();
  const next = markDividendReceived(p, 'auto-1', { paymentDate: '2026-02-20', grossAmount: 480, taxWithheld: 72 });
  validate(next);
  assert.equal(p.dividends![0].status, 'expected');
  const d = next.dividends![0];
  assert.deepEqual([d.status, d.paymentDate, d.grossAmount, d.taxWithheld], ['received', '2026-02-20', 480, 72]);
  const row = taxSummary(next).dividends[0];
  assert.deepEqual([row.status, row.grossAmount, row.tax, row.netAmount], ['received', 480, 72, 408]);
  assert.equal(taxSummary(next).totalDividendIncomeGross, 480);
  assert.equal(taxSummary(p).totalDividendIncomeGross, 0);
});

test('markDividendReceived keeps the expected figure when gross and tax are blank', () => {
  const next = markDividendReceived(withExpected(), 'auto-1', { paymentDate: '2026-02-20', grossAmount: null, taxWithheld: null });
  const d = next.dividends![0];
  assert.deepEqual([d.status, d.grossAmount, d.taxWithheld], ['received', 500, undefined]);
  assert.equal(taxSummary(next).totalDividendIncomeGross, 500);
});

test('markDividendReceived rejects bad dates, negative amounts, unknown, voided and already received dividends', () => {
  const p = withExpected();
  assert.throws(() => markDividendReceived(p, 'auto-1', { paymentDate: '2026-02-30' }), /valid payment date/);
  assert.throws(() => markDividendReceived(p, 'auto-1', { paymentDate: '2026-02-20', grossAmount: -1 }), /positive numbers/);
  assert.throws(() => markDividendReceived(p, 'auto-1', { paymentDate: '2026-02-20', taxWithheld: -1 }), /positive numbers/);
  assert.throws(() => markDividendReceived(p, 'nope', { paymentDate: '2026-02-20' }), /no longer exists/);
  const voided = voidEntry(p, 'dividend', 'auto-1');
  assert.throws(() => markDividendReceived(voided, 'auto-1', { paymentDate: '2026-02-20' }), /no longer exists/);
  const done = markDividendReceived(p, 'auto-1', { paymentDate: '2026-02-20' });
  assert.throws(() => markDividendReceived(done, 'auto-1', { paymentDate: '2026-02-21' }), /already received/);
});

test('changeNotifications edits a copy of the notification list', () => {
  const p = base();
  p.notifications = [{ id: 'n1', at: '2026-02-01T00:00:00Z', kind: 'info', title: 't', body: '', read: false }];
  const next = changeNotifications(p, (list) => clearOne(list, 'n1', '2026-02-02T00:00:00Z'));
  validate(next);
  assert.equal(p.notifications[0].clearedAt, undefined);
  assert.deepEqual([next.notifications![0].read, next.notifications![0].clearedAt], [true, '2026-02-02T00:00:00Z']);
  assert.deepEqual(changeNotifications(base(), (list) => list).notifications, []);
});

test('setFilerStatus writes the web taxProfile field without touching the original', () => {
  const p = base();
  const next = setFilerStatus(p, 'non-filer');
  assert.deepEqual(next.taxProfile, { filerStatus: 'non-filer' });
  assert.notEqual(next, p);
  assert.deepEqual(p.taxProfile, { filerStatus: 'filer' }, 'blank portfolio default is untouched');
  validate(next);
  assert.deepEqual(setFilerStatus(next, 'filer').taxProfile, { filerStatus: 'filer' });
});

test('recording a trade keeps gold and silver assets untouched', () => {
  const p = base();
  p.assets = [{ id: 'g1', kind: 'metal', name: 'Gold 24K', metal: 'gold', karat: 24, note: '', entries: [{ id: 'e1', type: 'buy', date: '2026-01-05', grams: 11.6638, amount: 400000, note: '' }] }];
  const next = recordTrade(p, buy(10, 100));
  assert.deepEqual(next.assets, p.assets);
  validate(next);
});

test('recording a trade keeps savings plans untouched', () => {
  const p = base();
  p.assets = [{ id: 'p1', kind: 'plan', name: 'Mahana Bachat', provider: 'pak-qatar-mbp', note: '', entries: [{ id: 'e1', type: 'contribution', date: '2026-01-05', amount: 50000, note: '' }], valuations: [], rules: [] }];
  const next = recordTrade(p, buy(10, 100));
  assert.deepEqual(next.assets, p.assets);
  validate(next);
});

test('recording a trade keeps mutual funds untouched', () => {
  const p = base();
  p.assets = [{ id: 'f1', kind: 'fund', name: 'Meezan Islamic Fund', mufapId: '5', amc: 'Al Meezan', fundName: 'Meezan Islamic Fund', category: 'Equity', note: '', entries: [{ id: 'e1', type: 'buy', date: '2026-01-05', units: 100, amount: 5000, note: '' }], manualNavs: [], rules: [] }];
  const next = recordTrade(p, buy(10, 100));
  assert.deepEqual(next.assets, p.assets);
  validate(next);
});
