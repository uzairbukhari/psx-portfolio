import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_CATALOG, parseBatch, validateEvent } from '../lib/analytics-events.ts';
import { activeCounts, dailyActive, retentionCohorts, returnedWithinWeek, weekStart, pktDay } from '../lib/analytics-report.ts';
import { shapeReport, userKey } from '../lib/analytics-store.ts';

test('catalog events accept only closed-enum props', () => {
  assert.deepEqual(validateEvent({ event: 'entry_added', props: { kind: 'buy' } }), { event: 'entry_added', props: { kind: 'buy' } });
  assert.equal(validateEvent({ event: 'entry_added', props: { kind: 'MEBL' } }), null);
  assert.equal(validateEvent({ event: 'entry_added', props: { ticker: 'MEBL' } }), null);
  assert.equal(validateEvent({ event: 'entry_added', props: { kind: 'buy', amount: '5000' } }), null);
  assert.equal(validateEvent({ event: 'made_up' }), null);
  assert.equal(validateEvent({ event: '__proto__' }), null);
  assert.equal(validateEvent({ event: 'app_opened', props: { x: 'y' } }), null);
});

test('catalog has no prop that could carry financial or free-text data', () => {
  const banned = /ticker|symbol|amount|qty|quantity|price|value|name|note|email|title|text|message|company|holding|cost/i;
  for (const [event, props] of Object.entries(EVENT_CATALOG))
    for (const [prop, values] of Object.entries(props)) {
      assert.doesNotMatch(prop, banned, `${event}.${prop}`);
      for (const v of values) assert.match(v, /^[a-z0-9_]{1,20}$/, `${event}.${prop}=${v}`);
    }
});

test('account_state accepts only none or exists', () => {
  assert.ok(validateEvent({ event: 'account_state', props: { vault: 'exists' } }));
  assert.equal(validateEvent({ event: 'account_state', props: { vault: 'maybe' } }), null);
});

test('batches drop server-only and invalid events and reject a bad envelope', () => {
  const ok = parseBatch({ sessionId: 'abcdefgh1', platform: 'web', events: [
    { event: 'app_opened' }, { event: 'signed_up', props: { platform: 'web' } }, { event: 'entry_added', props: { kind: 'zzz' } },
  ] });
  assert.deepEqual(ok.events.map((e) => e.event), ['app_opened']);
  assert.equal(parseBatch({ sessionId: 'x', platform: 'web', events: [] }), null);
  assert.equal(parseBatch({ sessionId: 'abcdefgh1', platform: 'mars', events: [] }), null);
  assert.equal(parseBatch(null), null);
});

test('active users, stickiness and daily series', () => {
  const rows = [
    { userKey: 'a', day: '2026-10-07' }, { userKey: 'b', day: '2026-10-07' },
    { userKey: 'a', day: '2026-10-03' }, { userKey: 'c', day: '2026-09-20' }, { userKey: 'd', day: '2026-08-01' },
  ];
  const c = activeCounts(rows, '2026-10-07');
  assert.deepEqual([c.dau, c.wau, c.mau], [2, 2, 3]);
  assert.equal(c.stickiness, 2 / 3);
  const series = dailyActive(rows, '2026-10-07', 3);
  assert.deepEqual(series, [{ day: '2026-10-05', users: 0 }, { day: '2026-10-06', users: 0 }, { day: '2026-10-07', users: 2 }]);
});

test('weeks start on Monday and PKT days roll over at 19:00 UTC', () => {
  assert.equal(weekStart('2026-10-07'), '2026-10-05');
  assert.equal(weekStart('2026-10-04'), '2026-09-28');
  assert.equal(pktDay(new Date('2026-10-07T19:30:00Z')), '2026-10-08');
});

test('retention cohorts and week-one return', () => {
  const signups = [{ userKey: 'a', day: '2026-09-22' }, { userKey: 'b', day: '2026-09-23' }];
  const activity = [...signups, { userKey: 'a', day: '2026-09-29' }, { userKey: 'a', day: '2026-10-06' }];
  const [cohort] = retentionCohorts(signups, activity, '2026-10-07', 3);
  assert.equal(cohort.week, '2026-09-21');
  assert.deepEqual(cohort.retained, [1, 0.5, 0.5, null]);
  assert.equal(returnedWithinWeek(signups, activity), 1);
});

test('user key is stable, case-insensitive and does not contain the email', async () => {
  const a = await userKey('Me@Example.com', 'secret');
  assert.equal(a, await userKey('me@example.com', 'secret'));
  assert.notEqual(a, await userKey('me@example.com', 'other'));
  assert.match(a, /^[0-9a-f]{32}$/);
});

test('report hides navigation noise and keeps failures separate', () => {
  const r = shapeReport({
    today: '2026-10-07', now: new Date('2026-10-07T10:00:00Z'), includeAdmin: false, activity: [], signups: [],
    features: [
      { event: 'screen_viewed', platform: 'web', n: 9, users: 3 }, { event: 'entry_added', platform: 'web', n: 4, users: 2 },
      { event: 'entry_added', platform: 'android', n: 1, users: 1 }, { event: 'import_failed', platform: 'web', n: 1, users: 1 },
    ],
    screens: [], accounts: { total: 3, signups30: 2, signups7: 1 }, signupSeries: [],
    funnelCounts: { landing: 10, clicked: 4, signedUp: 2, vault: 2, content: 1 },
  });
  assert.deepEqual(r.features.map((f) => f.event), ['entry_added', 'import_failed']);
  assert.equal(r.features[0].web, 4); assert.equal(r.features[0].phone, 1);
  assert.deepEqual(r.errors.map((f) => f.event), ['import_failed']);
  assert.equal(r.funnel.length, 6);
});

import { eventsForSave } from '../lib/analytics-diff.ts';
const base = { companies: [], trades: [], quotes: {}, budgets: {}, dividends: [], assets: [] };
const trade = (id, kind, extra = {}) => ({ id, ticker: 'MEBL', kind, date: '2026-01-01', shares: 10, price: 100, fees: 0, month: '2026-01', note: 'secret', ...extra });

test('saves become kind-only events and leak nothing', () => {
  const prev = { ...base, trades: [trade('1', 'buy')] };
  const added = eventsForSave(prev, { ...prev, trades: [...prev.trades, trade('2', 'sell')] });
  assert.deepEqual(added, [{ event: 'entry_added', props: { kind: 'sell' } }]);
  const edited = eventsForSave(prev, { ...prev, trades: [trade('1', 'buy', { voided: true }), trade('3', 'buy')] });
  assert.deepEqual(edited, [{ event: 'entry_edited', props: { kind: 'buy' } }]);
  const deleted = eventsForSave(prev, { ...prev, trades: [trade('1', 'buy', { voided: true })] });
  assert.deepEqual(deleted, [{ event: 'entry_deleted', props: { kind: 'buy' } }]);
  const withAsset = eventsForSave(prev, { ...prev, assets: [{ id: 'a', kind: 'metal', metal: 'gold' }], budgets: { MEBL: 5 } });
  assert.deepEqual(withAsset.map((e) => e.event), ['asset_added', 'targets_saved']);
  const imported = eventsForSave(prev, { ...prev, trades: [...prev.trades, trade('4', 'buy')] }, 'ahl');
  assert.deepEqual(imported, [{ event: 'import_completed', props: { source: 'ahl' } }]);
  for (const e of [...added, ...edited, ...withAsset]) assert.equal(JSON.stringify(e).includes('MEBL'), false);
});

import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { noteSignIn, resolveOrigin, insertEvents, usageReport, deleteUserEvents } from '../lib/analytics-store.ts';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE mobile_sessions (id text, email text, platform text, created_at text, last_seen_at text)');
  for (const f of ['0032_powerful_mindworm.sql'])
    sqlite.exec(readFileSync(new URL(`../drizzle/${f}`, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
    exec: () => sqlite.prepare(sql).run(...args),
  });
  return { sqlite, prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s.exec()) };
}

test('sign-up flow: new account becomes a signup, existing vault becomes existing', async () => {
  const db = d1();
  const now = new Date('2026-10-07T10:00:00Z');
  await noteSignIn(db, 'new@x.com', 'web', 'sec', false, now);
  await noteSignIn(db, 'old@x.com', 'android', 'sec', false, now);
  await resolveOrigin(db, 'new@x.com', false, 'sec', false, now);
  await resolveOrigin(db, 'old@x.com', true, 'sec', false, now);
  await resolveOrigin(db, 'new@x.com', false, 'sec', false, now); // idempotent: no second signed_up
  const origins = Object.fromEntries(db.sqlite.prepare('SELECT email, origin FROM app_users').all().map((r) => [r.email, r.origin]));
  assert.deepEqual(origins, { 'new@x.com': 'signup', 'old@x.com': 'existing' });
  const events = db.sqlite.prepare('SELECT event FROM analytics_events ORDER BY id').all().map((r) => r.event);
  assert.deepEqual(events.sort(), ['signed_in', 'signed_in', 'signed_up']);
  // The events table never holds the email.
  assert.doesNotMatch(JSON.stringify(db.sqlite.prepare('SELECT * FROM analytics_events').all()), /@/);
});

test('usage report counts users, excludes admin activity and deletes with the account', async () => {
  const db = d1();
  const now = new Date('2026-10-07T10:00:00Z');
  await noteSignIn(db, 'a@x.com', 'web', 'sec', false, now);
  await resolveOrigin(db, 'a@x.com', false, 'sec', false, now);
  const key = await userKey('a@x.com', 'sec');
  await insertEvents(db, { sessionId: 'sess-0001', userKey: key, platform: 'web' }, [
    { event: 'screen_viewed', props: { screen: 'reports' } }, { event: 'entry_added', props: { kind: 'buy' } },
  ], now);
  await insertEvents(db, { sessionId: 'sess-0002', userKey: 'adminkey', platform: 'web', isAdmin: true }, [{ event: 'entry_added', props: { kind: 'sell' } }], now);
  const r = await usageReport(db, false, now);
  assert.equal(r.active.dau, 1);
  assert.equal(r.signups7, 1);
  assert.equal(r.features.find((f) => f.event === 'entry_added').users, 1);
  assert.deepEqual(r.screens.map((s) => [s.screen, s.users]), [['reports', 1]]);
  assert.equal((await usageReport(db, true, now)).active.dau, 2);
  await deleteUserEvents(db, 'a@x.com', 'sec');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events WHERE user_key=?').get(key).n, 0);
});
