import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importCdcDividends,
  parseCdcAmount,
  parseCdcPaymentDate,
} from '../lib/imports/cdc-dividends.ts';

const companies = [
  { ticker: 'MEBL', name: 'Meezan', target: 0, approved: false, screenDate: '', note: '' },
];
const row = (over = {}) => ({
  dividendStatus: 'PAID',
  eventId: 'E1',
  securitySymbol: 'mebl',
  paymentDate: '05/03/2025',
  grossDividendAmount: '1,000.50',
  netDividendAmount: '850.43',
  financialYear: '2024',
  ...over,
});

test('parses amounts and dates', () => {
  assert.equal(parseCdcAmount('1,234.5'), 1234.5);
  assert.equal(parseCdcPaymentDate('5/3/2025'), '2025-03-05');
  assert.equal(parseCdcPaymentDate('31/02/2025'), null);
  assert.equal(parseCdcPaymentDate('nope'), null);
});
test('imports a paid row and uppercases the ticker', () => {
  const r = importCdcDividends([row()], companies, []);
  assert.equal(r.imported, 1);
  assert.equal(r.dividends[0].ticker, 'MEBL');
  assert.equal(r.dividends[0].date, '2025-03-05');
  assert.equal(r.dividends[0].grossAmount, 1000.5);
  assert.equal(r.dividends[0].source, 'import');
});
test('accepts a { data: [...] } wrapper', () => {
  assert.equal(importCdcDividends({ data: [row()] }, companies, []).imported, 1);
});
test('skips unpaid, duplicate, unknown ticker and invalid rows', () => {
  const existing = [
    { id: 'x', ticker: 'MEBL', date: '2025-03-05', source: 'import', grossAmount: 1, externalId: 'E1', note: '' },
  ];
  const r = importCdcDividends(
    [
      row({ dividendStatus: 'PENDING', eventId: 'A' }),
      row({ eventId: 'E1' }),
      row({ eventId: 'B', securitySymbol: 'ZZZZ' }),
      row({ eventId: 'C', netDividendAmount: '2000' }),
      row({ eventId: 'D', paymentDate: 'bad' }),
    ],
    companies,
    existing,
  );
  assert.equal(r.imported, 0);
  assert.deepEqual(
    [r.skippedNotPaid, r.skippedDuplicate, r.skippedUnknownTicker, r.skippedInvalid],
    [1, 1, 1, 2],
  );
});
test('de-duplicates repeated event ids within one file', () => {
  const r = importCdcDividends([row(), row()], companies, []);
  assert.equal(r.imported, 1);
  assert.equal(r.skippedDuplicate, 1);
});
test('garbage input imports nothing', () => {
  assert.equal(importCdcDividends(null, companies, []).imported, 0);
  assert.equal(importCdcDividends('x', companies, []).imported, 0);
});
