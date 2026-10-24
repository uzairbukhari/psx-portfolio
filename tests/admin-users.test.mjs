import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { insertEvents, noteSignIn, userKey, userKeys } from '../lib/analytics-store.ts';
import { userDirectory, userTimeline } from '../lib/admin-users-store.ts';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE mobile_sessions (id text, email text, platform text, created_at text, last_seen_at text)');
  sqlite.exec('CREATE TABLE user_roles (email text PRIMARY KEY, role text NOT NULL, created_at text NOT NULL)');
  for (const f of ['0032_powerful_mindworm.sql', '0034_striped_zarda.sql', '0038_app_users_profile.sql', '0042_complex_johnny_blaze.sql', '0043_productive_kabuki.sql'])
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

const now = new Date('2026-10-07T10:00:00Z');

test('userKeys matches userKey', async () => {
  const keys = await userKeys(['A@x.com', ' b@x.com'], 'sec');
  assert.deepEqual(keys, [await userKey('a@x.com', 'sec'), await userKey('b@x.com', 'sec')]);
});

test('sign-in stores name and picture, keeps them when a later sign-in has none, and events stay email-free', async () => {
  const db = d1();
  await noteSignIn(db, 'p@x.com', 'web', 'sec', false, now, { name: ' Pat Lee ', picture: 'https://lh3.googleusercontent.com/a' });
  await noteSignIn(db, 'p@x.com', 'android', 'sec', false, now, {});
  const row = db.sqlite.prepare('SELECT name, picture, last_platform FROM app_users').get();
  assert.deepEqual({ ...row }, { name: 'Pat Lee', picture: 'https://lh3.googleusercontent.com/a', last_platform: 'android' });
  assert.doesNotMatch(JSON.stringify(db.sqlite.prepare('SELECT * FROM analytics_events').all()), /@|Pat/);
});

test('directory joins events to accounts, hides internal ones and builds a timeline', async () => {
  const db = d1();
  for (const e of ['a@x.com', 'b@x.com', 'boss@x.com']) await noteSignIn(db, e, 'web', 'sec', false, now, { name: e.split('@')[0] });
  db.sqlite.exec("INSERT INTO user_roles (email, role, created_at) VALUES ('boss@x.com', 'super_admin', '2026-01-01')");
  const a = await userKey('a@x.com', 'sec');
  await insertEvents(db, { sessionId: 'sess-0001', userKey: a, platform: 'web' }, [
    { event: 'vault_created', props: {} }, { event: 'entry_added', props: { kind: 'buy' } }, { event: 'targets_saved', props: {} },
    { event: 'screen_viewed', props: { screen: 'holdings' } }, { event: 'screen_viewed', props: { screen: 'sip' } },
  ], now);

  const dir = await userDirectory(db, 'sec', false, now);
  assert.deepEqual(dir.users.map((u) => u.email).sort(), ['a@x.com', 'b@x.com']);
  const by = Object.fromEntries(dir.users.map((u) => [u.email, u]));
  assert.equal(by['a@x.com'].stage, 'sip_targets');
  assert.equal(by['a@x.com'].hasUsage, true);
  assert.equal(by['b@x.com'].stage, 'signed_up');
  assert.equal(by['b@x.com'].hasUsage, false);
  assert.ok(by['b@x.com'].segments.includes('no_events'));
  assert.equal(dir.funnel[0].reached, 2);
  assert.equal(dir.funnel[3].reached, 1);
  assert.equal((await userDirectory(db, 'sec', true, now)).users.find((u) => u.email === 'boss@x.com').internal, true);

  const t = await userTimeline(db, 'sec', 'A@x.com', now);
  assert.equal(t.name, 'a');
  assert.equal(t.sessions[0].items.at(-1).label, 'Holdings › Monthly Picks');
  assert.equal(await userTimeline(db, 'sec', 'nobody@x.com', now), null);
});
