import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { alertsFrom, buildAlertPush, sendAdminAlerts, ALERT_PUSH } from '../lib/admin-alerts.ts';
import { storeWorkerDay } from '../lib/cf-analytics.ts';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../drizzle/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(`../drizzle/${f}`, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
    exec: () => sqlite.prepare(sql).run(...args),
  });
  return { sqlite, prepare: (sql) => stmt(sql), batch: async (l) => l.map((s) => s.exec()) };
}
const now = new Date('2026-10-14T07:00:00Z');
const TOKEN = 'ExponentPushToken[abcdefghijkl]';

test('alerts come from failing pipelines, limit trouble and error spikes only', () => {
  const none = alertsFrom({ pipelines: [{ id: 'quotes', label: 'PSX quotes', status: 'ok' }] }, { status: 'ok', connected: true, today: { limitHits: 0, usedShare: 0.1 }, server: { lastHour: 0 } }, { errors24h: 3, errorsPrev24h: 0 });
  assert.deepEqual(none, []);
  const keys = alertsFrom(
    { pipelines: [{ id: 'facts', label: 'Company facts', status: 'failing' }, { id: 'history', label: 'x', status: 'late' }] },
    { status: 'failing', connected: true, today: { limitHits: 2, usedShare: 0.85 }, server: { lastHour: 25 } }, { errors24h: 12, errorsPrev24h: 4 }).map((a) => a.key);
  assert.deepEqual(keys, ['pipeline:facts', 'platform:limit', 'platform:requests', 'platform:server-errors', 'errors:spike']);
});

test('the push is generic: no details, one per distinct valid token', () => {
  const messages = buildAlertPush([TOKEN, TOKEN, 'nope']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].body, ALERT_PUSH.body);
  assert.doesNotMatch(JSON.stringify(messages), /facts|failing|limit/i);
});

test('an issue is pushed to super admins once per day, and not at all with nobody to tell', async () => {
  const db = d1();
  const calls = [];
  const fetcher = async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ data: [] }); };
  await storeWorkerDay(db, 'psx-portfolio-sip', { requests: 500, errors: 5, limitHits: 5, cpuP50: 1, cpuP99: 2, statuses: { exceededCpu: 5 } }, now);
  // Nobody registered: nothing is sent and nothing is marked, so it is retried later.
  let r = await sendAdminAlerts(db, { now }, fetcher);
  assert.equal(r.sent, 0);
  assert.equal(calls.length, 0);
  db.sqlite.prepare("INSERT INTO user_roles (email,role,created_at) VALUES ('boss@x.com','super_admin','2026-01-01'), ('tester@x.com','tester','2026-01-01')").run();
  for (const [id, email, token] of [['s1', 'boss@x.com', TOKEN], ['s2', 'tester@x.com', 'ExponentPushToken[zzzzzzzzzzzz]'], ['s3', 'user@x.com', 'ExponentPushToken[yyyyyyyyyyyy]']])
    db.sqlite.prepare("INSERT INTO mobile_sessions (id,email,device_name,platform,created_at,last_seen_at,push_token) VALUES (?,?,?,?,?,?,?)").run(id, email, 'd', 'android', '2026-01-01', '2026-01-01', token);
  r = await sendAdminAlerts(db, { now }, fetcher);
  assert.equal(r.sent, 1);
  assert.deepEqual(calls[0].map((m) => m.to), [TOKEN]);
  // Same day, same issues: quiet.
  r = await sendAdminAlerts(db, { now: new Date(now.getTime() + 3_600_000) }, fetcher);
  assert.equal(r.sent, 0);
  assert.equal(calls.length, 1);
  // Next day it can be sent again.
  r = await sendAdminAlerts(db, { now: new Date(now.getTime() + 24 * 3_600_000) }, fetcher);
  assert.equal(r.sent, 1);
  const log = db.sqlite.prepare("SELECT actor,action FROM admin_actions WHERE action='alert_sent'").all();
  assert.equal(log.length, 2);
});

test('a push the service refuses is not marked as sent', async () => {
  const db = d1();
  db.sqlite.prepare("INSERT INTO user_roles (email,role,created_at) VALUES ('boss@x.com','super_admin','2026-01-01')").run();
  db.sqlite.prepare("INSERT INTO mobile_sessions (id,email,device_name,platform,created_at,last_seen_at,push_token) VALUES ('s','boss@x.com','d','android','2026-01-01','2026-01-01',?)").run(TOKEN);
  await storeWorkerDay(db, 'w', { requests: 1, errors: 1, limitHits: 1, cpuP50: 1, cpuP99: 1, statuses: {} }, now);
  const r = await sendAdminAlerts(db, { now }, async () => new Response('no', { status: 500 }));
  assert.equal(r.sent, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS c FROM refresh_state WHERE kind='admin-alert'").get().c, 0);
});
