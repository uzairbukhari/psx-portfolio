import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPortfolio, validate } from '../../../lib/portfolio.ts';
import { recordBuys } from './mutations.ts';
import { estimatedFees, parseReview, reviewRows } from './record-buys.ts';

const sample = () => {
  const p = blankPortfolio();
  p.companies = [
    { ticker: 'AAA', name: 'Alpha', sector: 'Bank', target: 50, approved: true, screenDate: '', note: '' },
    { ticker: 'BBB', name: 'Beta', sector: 'Bank', target: 50, approved: true, screenDate: '', note: '' },
  ];
  return p;
};

test('review rows keep only buys with shares and a price', () => {
  const rows = reviewRows([
    { ticker: 'AAA', name: 'Alpha', shares: 3, price: 100 },
    { ticker: 'BBB', name: 'Beta', shares: 0, price: 50 },
    { ticker: 'CCC', name: 'Gamma', shares: 2, price: null },
    { ticker: 'DDD', name: 'Delta', shares: null, price: 10 },
  ]);
  assert.deepEqual(rows, [{ ticker: 'AAA', name: 'Alpha', shares: '3', price: '100' }]);
});

test('parseReview totals the edited rows and flags bad ones', () => {
  const ok = parseReview(
    [
      { ticker: 'AAA', name: 'Alpha', shares: '10', price: '100' },
      { ticker: 'BBB', name: 'Beta', shares: '2', price: '1,050.50' },
    ],
    0.5,
  );
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.gross, 3101);
  assert.equal(ok.fees, estimatedFees(10, 100, 0.5) + estimatedFees(2, 1050.5, 0.5));
  assert.equal(ok.total, ok.gross + ok.fees);
  const bad = parseReview([{ ticker: 'AAA', name: 'Alpha', shares: '1.5', price: '100' }, { ticker: 'BBB', name: 'Beta', shares: '2', price: '' }], 0);
  assert.equal(Object.keys(bad.errors).length, 2);
  assert.equal(bad.buys.length, 0);
});

test('recordBuys appends every buy to one new portfolio and leaves the original alone', () => {
  const p = sample();
  const next = recordBuys(p, [{ ticker: 'AAA', shares: 10, price: 100, fees: 5 }, { ticker: 'BBB', shares: 3, price: 200 }], '2026-10', '2026-10-02', 'SIP');
  validate(next);
  assert.equal(p.trades.length, 0);
  assert.equal(next.trades.length, 2);
  assert.deepEqual(next.trades.map((t) => [t.ticker, t.kind, t.month, t.date, t.fees]), [
    ['AAA', 'buy', '2026-10', '2026-10-02', 5],
    ['BBB', 'buy', '2026-10', '2026-10-02', 0],
  ]);
  assert.notEqual(next.trades[0].id, next.trades[1].id);
});

test('recordBuys rejects bad rows without partially applying', () => {
  const p = sample();
  assert.throws(() => recordBuys(p, [], '2026-10'), /no buys/);
  assert.throws(() => recordBuys(p, [{ ticker: 'ZZZ', shares: 1, price: 1 }], '2026-10'), /not in your portfolio/);
  assert.throws(() => recordBuys(p, [{ ticker: 'AAA', shares: 1.5, price: 1 }], '2026-10'), /whole number/);
  assert.throws(() => recordBuys(p, [{ ticker: 'AAA', shares: 1, price: 0 }], '2026-10'), /price/);
  assert.throws(() => recordBuys(p, [{ ticker: 'AAA', shares: 1, price: 1 }], '2026-13'), /Invalid month/);
  assert.equal(p.trades.length, 0);
});
