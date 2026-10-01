import test from 'node:test';
import assert from 'node:assert/strict';
import { announcementKey, buildPushMessages, isExpoPushToken, newAnnouncements } from '../lib/dividend-push.ts';

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

test('messages go only to phones holding the ticker, once per token', () => {
  const rows = [row(), row({ kind: 'bonus', percent: 10, perShareRs: null })];
  const holder = { email: 'a@x.com', token: TOKEN, tickers: new Set(['MEBL']) };
  const other = { email: 'b@x.com', token: 'ExponentPushToken[zzzzzzzz12345678]', tickers: new Set(['LUCK']) };
  const bad = { email: 'c@x.com', token: 'nope', tickers: new Set(['MEBL']) };
  const out = buildPushMessages(rows, [holder, other, bad]);
  assert.equal(out.length, 2);
  assert.ok(out.every((m) => m.to === TOKEN && m.data.ticker === 'MEBL'));
  assert.match(out[0].body, /Rs 2.5 per share/);
  assert.match(out[1].body, /10% bonus shares/);
  assert.equal(buildPushMessages(rows, [holder, holder]).length, 2);
});
