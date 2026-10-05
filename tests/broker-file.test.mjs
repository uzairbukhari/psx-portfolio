import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFromReviewed, parseSavedFormat, redactBrokerText } from '../lib/broker-file.ts';
import { validateBrokerStatement } from '../lib/broker-import.ts';

test('a reviewed tabular format parses a later same-layout export without AI', () => {
  const headers = ['Symbol', 'Date', 'Side', 'Quantity', 'Rate', 'Charges', 'Voucher'];
  const one = { headers, rows: [['MEBL', '2026-09-01', 'BUY', '10', '100', '1', 'J1']], signature: 'symbol|date|side|quantity|rate|charges|voucher', text: '' };
  const statement = validateBrokerStatement({ broker: 'JS Global', account: 'main', report: 'trades', trades: [{ ticker: 'MEBL', date: '2026-09-01', side: 'buy', shares: 10, price: 100, fees: 1, reference: 'J1', line: 2 }], holdings: [], warnings: [] });
  const format = formatFromReviewed(one, statement);
  assert.ok(format);
  const later = { ...one, rows: [['FFC', '2026-09-03', 'SELL', '5', '120', '2', 'J2']] };
  const parsed = parseSavedFormat(later, format);
  assert.equal(parsed.trades[0].ticker, 'FFC');
  assert.equal(parsed.trades[0].side, 'sell');
  assert.equal(parsed.trades[0].fees, 2);
});

test('personal headers are removed before model extraction', () => {
  const text = 'CNIC 42101-1234567-1 email abc@example.com phone 03001234567 Account No: 123456789 MEBL 10 @ 100';
  const redacted = redactBrokerText(text);
  assert.ok(!redacted.includes('abc@example.com'));
  assert.ok(!redacted.includes('42101-1234567-1'));
  assert.ok(!redacted.includes('123456789'));
  assert.ok(redacted.includes('MEBL 10 @ 100'));
});

test('a reviewed day-first date and formatted numbers are reused locally', () => {
  const table = { headers: ['Symbol', 'Date', 'Side', 'Quantity', 'Rate', 'Charges', 'Voucher'], rows: [['MEBL', '01/09/2026', 'BUY', '10', '100.00', '1.00', 'J1']], signature: 'stable', text: '' };
  const s = validateBrokerStatement({ broker: 'JS Global', account: '', report: 'trades', trades: [{ ticker: 'MEBL', date: '2026-09-01', side: 'buy', shares: 10, price: 100, fees: 1, reference: 'J1', line: 2 }], holdings: [], warnings: [] });
  const format = formatFromReviewed(table, s);
  assert.equal(format?.dateStyle, 'dmy');
  assert.equal(parseSavedFormat({ ...table, rows: [['FFC', '03/09/2026', 'SELL', '5', '120.00', '2.00', 'J2']] }, format).trades[0].date, '2026-09-03');
});

test('holdings-only columns can be reused; mixed statements cannot lose a section', () => {
  const table = { headers: ['Symbol', 'As of', 'Quantity'], rows: [['MEBL', '01/09/2026', '10']], signature: 'symbol|asof|quantity', text: '' };
  const holdings = [{ ticker: 'MEBL', asOf: '2026-09-01', shares: 10, line: 2 }];
  const s = validateBrokerStatement({ broker: 'KTrade', account: '', report: 'holdings', trades: [], holdings, warnings: [] });
  const format = formatFromReviewed(table, s);
  assert.equal(format?.report, 'holdings');
  assert.equal(parseSavedFormat({ ...table, rows: [['FFC', '03/09/2026', '5']] }, format).holdings[0].shares, 5);
  const mixed = { ...s, report: 'both', trades: [{ ticker: 'MEBL', date: '2026-09-01', side: 'buy', shares: 10, price: 100, fees: 1, reference: 'J1', line: 2 }] };
  assert.equal(formatFromReviewed(table, mixed), null);
});
