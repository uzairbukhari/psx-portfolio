import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, holdings, validate } from '../../../lib/portfolio.ts';
import { isIsoDate, parseNumber, recordDividend, recordSplit, recordTrade, voidEntry } from './mutations.ts';

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
