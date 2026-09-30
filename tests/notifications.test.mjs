import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, pendingAutoDividends } from '../lib/portfolio.ts';
import { announcementNotifications, dividendNotifications, addNotifications, MAX_NOTIFICATIONS } from '../lib/notifications.ts';

const NOW = '2025-08-20T10:00:00Z';
const buy = (date, shares) => ({ id: 'b' + date, ticker: 'MEBL', kind: 'buy', date, shares, price: 100, fees: 0, month: date.slice(0, 7), note: '' });
const pf = (extra = {}) => ({
  companies: [{ ticker: 'MEBL', name: 'Meezan', target: 0, approved: true, screenDate: '', note: '' }],
  trades: [buy('2025-01-02', 100)], quotes: {}, budgets: {}, ...extra,
});
const ann = (extra = {}) => ({
  ticker: 'MEBL', announcedOn: '2025-08-13', period: '30/06/2025(HYR)', details: '70%(ii) (D)', kind: 'cash',
  percent: 70, perShareRs: null, bookClosureStart: '2025-08-27', bookClosureEnd: '2025-08-28', ...extra,
});

test('upcoming cash dividend produces an estimate notification once', () => {
  const p = pf();
  const [n] = announcementNotifications(p, [ann()], '2025-08-20', NOW);
  assert.equal(n.kind, 'payout-announced');
  assert.equal(n.id, 'ann:psx:MEBL:2025-08-27:2025-08-13:cash');
  assert.match(n.body, /Rs 7\/share/);
  assert.match(n.body, /700/);
  addNotifications(p, [n]);
  validate(p);
  assert.deepEqual(announcementNotifications(p, [ann()], '2025-08-20', NOW), []);
});

test('past cash announcements are left to the recorded notification; bonus is still announced', () => {
  const p = pf();
  assert.deepEqual(announcementNotifications(p, [ann()], '2025-09-01', NOW), []);
  const [b] = announcementNotifications(p, [ann({ kind: 'bonus', details: '10%(B)' })], '2025-09-01', NOW);
  assert.match(b.title, /bonus issue/);
  assert.match(b.body, /Not recorded automatically/);
  assert.deepEqual(announcementNotifications(p, [ann({ kind: 'bonus', announcedOn: '2025-01-01', bookClosureStart: '2025-01-10' })], '2025-09-01', NOW), [], 'old news skipped');
});

test('no notification when nothing is held or ticker unknown', () => {
  assert.deepEqual(announcementNotifications(pf({ trades: [] }), [ann()], '2025-08-20', NOW), []);
  assert.deepEqual(announcementNotifications(pf(), [ann({ ticker: 'LUCK' })], '2025-08-20', NOW), []);
});

test('recorded notifications describe source and amount; add dedupes and caps', () => {
  const p = pf();
  const divs = pendingAutoDividends(p, [ann()], '2026-01-01');
  const [n] = dividendNotifications(divs, NOW);
  assert.equal(n.id, 'div:psx:MEBL:2025-08-27:2025-08-13');
  assert.match(n.body, /automatically/);
  addNotifications(p, [n]);
  addNotifications(p, [n]);
  assert.equal(p.notifications.length, 1);
  const many = Array.from({ length: MAX_NOTIFICATIONS + 20 }, (_, i) => ({ ...n, id: 'x' + i }));
  addNotifications(p, many);
  assert.equal(p.notifications.length, MAX_NOTIFICATIONS);
  assert.equal(p.notifications[0].id, 'x0');
  validate(p);
});

test('validate rejects malformed notifications', () => {
  const good = { id: 'a', at: NOW, kind: 'info', title: 't', body: 'b', read: false };
  for (const bad of [{ ...good, kind: 'nope' }, { ...good, read: 'no' }, { ...good, at: 'never' }, { ...good, id: '' }]) {
    const p = pf({ notifications: [bad] });
    assert.throws(() => validate(p), /notifications/);
  }
  assert.throws(() => validate(pf({ notifications: [good, good] })), /notifications/);
});

test('cleared notifications stay for dedupe and validate', () => {
  const p = pf();
  const n = { id: 'a', at: NOW, kind: 'info', title: 't', body: 'b', read: true, clearedAt: NOW };
  addNotifications(p, [n]);
  addNotifications(p, [{ ...n, clearedAt: undefined, read: false }]);
  assert.equal(p.notifications.length, 1);
  assert.equal(p.notifications[0].clearedAt, NOW);
  validate(p);
  p.notifications[0].clearedAt = 'nope';
  assert.throws(() => validate(p), /Invalid notifications/);
});
