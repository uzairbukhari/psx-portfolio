import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../lib/portfolio.ts';
import {
  clearAll, clearOne, deleteCleared, expectedDividendFor, filterNotifications, isUnread, markAllRead,
  notificationCounts, restoreOne, setRead,
} from '../lib/notification-actions.ts';

const n = (id, at, extra = {}) => ({ id, at, kind: 'info', title: id, body: '', read: false, ...extra });
const LIST = [
  n('a', '2026-09-01T10:00:00Z'),
  n('b', '2026-09-03T10:00:00Z', { read: true }),
  n('c', '2026-09-02T10:00:00Z', { read: true, clearedAt: '2026-09-04T00:00:00Z' }),
  n('d', '2026-09-05T10:00:00Z', { clearedAt: '2026-09-06T00:00:00Z' }),
];

test('counts and filters match the web history page', () => {
  assert.deepEqual(notificationCounts(LIST), { inbox: 2, all: 4, unread: 1, cleared: 2 });
  assert.equal(isUnread(LIST[3]), false);
  assert.deepEqual(filterNotifications(LIST, 'all').map((x) => x.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(filterNotifications(LIST, 'inbox').map((x) => x.id), ['b', 'a']);
  assert.deepEqual(filterNotifications(LIST, 'unread').map((x) => x.id), ['a']);
  assert.deepEqual(filterNotifications(LIST, 'cleared').map((x) => x.id), ['d', 'c']);
  assert.deepEqual(LIST.map((x) => x.id), ['a', 'b', 'c', 'd']);
});

test('mark read and unread touch only that item', () => {
  assert.equal(setRead(LIST, 'a', true)[0].read, true);
  assert.equal(setRead(LIST, 'b', false)[1].read, false);
  assert.equal(LIST[0].read, false);
});

test('clearing sets clearedAt and read, keeps the item, and is not repeated', () => {
  const out = clearOne(LIST, 'a', '2026-10-01T00:00:00Z');
  assert.deepEqual([out[0].read, out[0].clearedAt], [true, '2026-10-01T00:00:00Z']);
  assert.equal(out.length, 4);
  assert.equal(clearOne(LIST, 'c', '2026-10-01T00:00:00Z')[2].clearedAt, '2026-09-04T00:00:00Z');
});

test('restore removes clearedAt; mark-all-read and clear-all skip what is already cleared', () => {
  const restored = restoreOne(LIST, 'c')[2];
  assert.equal('clearedAt' in restored, false);
  assert.equal(restored.read, true);
  const read = markAllRead(LIST);
  assert.ok(read.filter((x) => !x.clearedAt).every((x) => x.read));
  assert.equal(read[3].read, false);
  const cleared = clearAll(LIST, '2026-10-01T00:00:00Z');
  assert.deepEqual(cleared.map((x) => x.clearedAt), ['2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-09-04T00:00:00Z', '2026-09-06T00:00:00Z']);
});

test('deleteCleared is the only removal', () => {
  assert.deepEqual(deleteCleared(LIST).map((x) => x.id), ['a', 'b']);
});

test('results still pass portfolio validation', () => {
  const p = { companies: [], trades: [], quotes: {}, budgets: {}, notifications: clearAll(LIST, '2026-10-01T00:00:00Z') };
  validate(p);
});

const exp = { id: 'auto-psx:MEBL:2026-09-10:2026-09-01', externalId: 'psx:MEBL:2026-09-10:2026-09-01', ticker: 'MEBL', date: '2026-09-10', source: 'auto', status: 'expected' };
const pf = (dividends) => ({ companies: [], trades: [], quotes: {}, budgets: {}, dividends });

test('expectedDividendFor links recorded and announcement alerts to the expected dividend', () => {
  const p = pf([exp]);
  assert.equal(expectedDividendFor(p, { id: 'div:psx:MEBL:2026-09-10:2026-09-01', kind: 'dividend-recorded' }), exp);
  assert.equal(expectedDividendFor(p, { id: 'ann:psx:MEBL:2026-09-10:2026-09-01:cash', kind: 'payout-announced' }), exp);
  assert.equal(expectedDividendFor(p, { id: 'ann:psx:MEBL:2026-09-10:2026-09-01:bonus', kind: 'payout-announced' }), null);
  assert.equal(expectedDividendFor(p, { id: 'x', kind: 'info' }), null);
});

test('expectedDividendFor ignores received, voided, manual and missing dividends', () => {
  const alert = { id: 'div:psx:MEBL:2026-09-10:2026-09-01', kind: 'dividend-recorded' };
  assert.equal(expectedDividendFor(pf([{ ...exp, status: 'received' }]), alert), null);
  assert.equal(expectedDividendFor(pf([{ ...exp, voided: true }]), alert), null);
  assert.equal(expectedDividendFor(pf([{ ...exp, source: 'manual' }]), alert), null);
  assert.equal(expectedDividendFor(pf([]), alert), null);
  assert.equal(expectedDividendFor({ companies: [], trades: [], quotes: {}, budgets: {} }, alert), null);
  const manual = { id: 'm1', ticker: 'MEBL', date: '2026-09-10', source: 'manual' };
  assert.equal(expectedDividendFor(pf([manual]), { id: 'div:m1', kind: 'dividend-recorded' }), null);
});
