import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { checkRemove, checkSet, cleanNote, normalizeEmail } from '../lib/internal-accounts-rules.ts';
import { listInternalAccounts, internalUserKeys, removeInternalAccount, setInternalAccount } from '../lib/internal-accounts.ts';
import { auditLog, insertEvents, usageReport, userKey } from '../lib/analytics-store.ts';

const owner = { email: 'owner@x.com', role: 'super_admin', note: null };
const second = { email: 'second@x.com', role: 'super_admin', note: null };
const phone = { email: 'phone@x.com', role: 'tester', note: 'Android' };

test('emails are normalised and notes are cleaned', () => {
  assert.equal(normalizeEmail('  Owner@X.com '), 'owner@x.com');
  assert.equal(normalizeEmail('nope'), null);
  assert.equal(normalizeEmail(42), null);
  assert.equal(cleanNote('  Android\nphone  '), 'Android phone');
  assert.equal(cleanNote('x'.repeat(200)).length, 80);
  assert.equal(cleanNote('   '), null);
});

test('adding and changing roles follows the safety rules', () => {
  const list = [owner];
  assert.equal(checkSet(list, 'owner@x.com', { email: 'phone@x.com', role: 'tester' }), null);
  assert.match(checkSet(list, 'owner@x.com', { email: 'bad', role: 'tester' }), /valid email/);
  assert.match(checkSet(list, 'owner@x.com', { email: 'phone@x.com', role: 'user' }), /super admin or test/);
  // A new super admin needs the email typed twice.
  assert.match(checkSet(list, 'owner@x.com', { email: 'second@x.com', role: 'super_admin' }), /again/);
  assert.match(checkSet(list, 'owner@x.com', { email: 'second@x.com', role: 'super_admin', confirmEmail: 'other@x.com' }), /again/);
  assert.equal(checkSet(list, 'owner@x.com', { email: 'second@x.com', role: 'super_admin', confirmEmail: 'Second@x.com' }), null);
  // Nobody can demote themselves, and the last super admin stays.
  assert.match(checkSet([owner, second], 'owner@x.com', { email: 'owner@x.com', role: 'tester' }), /own super admin/);
  assert.match(checkSet([owner], 'second@x.com', { email: 'owner@x.com', role: 'tester' }), /at least one super admin/);
  assert.equal(checkSet([owner, second], 'owner@x.com', { email: 'second@x.com', role: 'tester' }), null);
});

test('removals follow the safety rules', () => {
  assert.equal(checkRemove([owner, phone], 'owner@x.com', 'phone@x.com'), null);
  assert.match(checkRemove([owner, phone], 'owner@x.com', 'ghost@x.com'), /not in the list/);
  assert.match(checkRemove([owner, second], 'owner@x.com', 'owner@x.com'), /own super admin/);
  assert.match(checkRemove([owner], 'second@x.com', 'owner@x.com'), /at least one/);
  assert.equal(checkRemove([owner, second], 'owner@x.com', 'second@x.com'), null);
});

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE mobile_sessions (id text, email text, platform text, created_at text, last_seen_at text)');
  sqlite.exec('CREATE TABLE user_roles (email text PRIMARY KEY, role text NOT NULL, created_at text NOT NULL)');
  for (const f of ['0032_powerful_mindworm.sql', '0034_striped_zarda.sql'])
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

test('the Accounts list is stored in user_roles and every change is logged', async () => {
  const db = d1();
  db.sqlite.prepare("INSERT INTO user_roles (email,role,created_at) VALUES ('owner@x.com','super_admin','2026-01-01')").run();
  await setInternalAccount(db, 'owner@x.com', { email: 'Phone@X.com', role: 'tester', note: 'Android' });
  await setInternalAccount(db, 'owner@x.com', { email: 'second@x.com', role: 'super_admin', confirmEmail: 'second@x.com' });
  const list = await listInternalAccounts(db);
  assert.deepEqual(list.map((a) => [a.email, a.role, a.note]), [['owner@x.com', 'super_admin', null], ['second@x.com', 'super_admin', null], ['phone@x.com', 'tester', 'Android']]);
  await assert.rejects(setInternalAccount(db, 'owner@x.com', { email: 'owner@x.com', role: 'tester' }), /own super admin/);
  await removeInternalAccount(db, 'owner@x.com', 'phone@x.com');
  assert.equal((await listInternalAccounts(db)).length, 2);
  const log = db.sqlite.prepare('SELECT actor,action,target FROM admin_actions ORDER BY id').all().map((r) => `${r.action}:${r.target}`);
  assert.deepEqual(log, ['account_added:phone@x.com', 'account_added:second@x.com', 'account_removed:phone@x.com']);
});

test('test accounts are left out of usage and audit reports, including events recorded before they were marked', async () => {
  const db = d1();
  const now = new Date('2026-10-07T10:00:00Z');
  const secret = 'sec';
  const add = (email) => db.sqlite.prepare("INSERT INTO app_users (email,first_seen_at,first_platform,last_seen_at,last_platform,origin) VALUES (?,?,?,?,?,'signup')").run(email, '2026-10-06T09:00:00Z', 'web', '2026-10-07T09:00:00Z', 'web');
  add('real@x.com'); add('tester@x.com');
  for (const email of ['real@x.com', 'tester@x.com'])
    await insertEvents(db, { sessionId: `sess-${email}`, userKey: await userKey(email, secret), platform: 'web' }, [
      { event: 'entry_added', props: { kind: 'buy' } }, { event: 'client_error', props: { area: 'import', code: 'pdf_unrecognized' } },
    ], now);
  // Marked as a tester after its events were recorded, so is_admin is 0 on them.
  db.sqlite.prepare("INSERT INTO user_roles (email,role,created_at) VALUES ('tester@x.com','tester','2026-10-07')").run();
  const keys = await internalUserKeys(db, secret);
  assert.deepEqual(keys, [await userKey('tester@x.com', secret)]);

  const usage = await usageReport(db, false, now, keys);
  assert.equal(usage.totalUsers, 1);
  assert.equal(usage.active.dau, 1);
  assert.equal(usage.features.find((f) => f.event === 'entry_added').users, 1);
  const all = await usageReport(db, true, now, []);
  assert.equal(all.totalUsers, 2);
  assert.equal(all.active.dau, 2);

  const audit = await auditLog(db, { days: 7 }, secret, now, keys);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].internal, false);
  const auditAll = await auditLog(db, { days: 7, includeAdmin: true }, secret, now, keys);
  assert.deepEqual(auditAll.rows.map((r) => r.internal).sort(), [false, true]);
});
