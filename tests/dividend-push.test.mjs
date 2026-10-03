import test from 'node:test';
import assert from 'node:assert/strict';
import { announcementKey, buildGenericPush, GENERIC_PUSH, isExpoPushToken, newAnnouncements } from '../lib/dividend-push.ts';

const row = (over = {}) => ({
  ticker: 'MEBL', bookClosureStart: '2026-10-10', bookClosureEnd: '2026-10-12', announcedOn: '2026-10-01',
  kind: 'cash', period: 'HY', details: '', percent: 25, perShareRs: 2.5, ...over,
});
const TOKEN = 'ExponentPushToken[abcdEFGH12345678]';

test('accepts Expo push tokens and rejects other strings', () => {
  assert.ok(isExpoPushToken(TOKEN));
  assert.ok(isExpoPushToken('ExpoPushToken[abcdEFGH12345678]'));
  assert.equal(isExpoPushToken('fcm-token'), false);
  assert.equal(isExpoPushToken(undefined), false);
});

test('only announcements that are new for already-seen tickers are pushed', () => {
  const old = row({ announcedOn: '2026-04-01' });
  const fresh = row();
  const firstSeen = row({ ticker: 'LUCK' });
  const result = newAnnouncements([old, fresh, firstSeen], new Set([announcementKey(old)]), new Set(['MEBL']));
  assert.deepEqual(result, [fresh]);
});

test('one generic message per distinct valid device, however many announcements', () => {
  const rows = [row(), row({ kind: 'bonus', percent: 10, perShareRs: null }), row({ ticker: 'LUCK' })];
  const out = buildGenericPush(rows, [TOKEN, TOKEN, 'ExponentPushToken[zzzzzzzz12345678]', 'nope']);
  assert.equal(out.length, 2);
  assert.deepEqual(new Set(out.map((m) => m.to)), new Set([TOKEN, 'ExponentPushToken[zzzzzzzz12345678]']));
  assert.deepEqual(buildGenericPush([], [TOKEN]), []);
});

test('push payloads carry no ticker, amount, holding or per-user content', () => {
  const rows = [row({ ticker: 'SECRETCO', perShareRs: 987.65, percent: 4321 })];
  const [message] = buildGenericPush(rows, [TOKEN]);
  const payload = JSON.stringify(message);
  assert.ok(!/SECRETCO|987|4321|MEBL/.test(payload));
  assert.equal(message.title, GENERIC_PUSH.title);
  assert.deepEqual(message.data, { kind: 'market-update' });
});
