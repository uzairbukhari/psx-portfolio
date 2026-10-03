import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  CHILD_TABLES,
  SHARED_TABLES,
  USER_TABLES,
  accountDeletionStatements,
  confirmationMatches,
} from '../lib/account-deletion.ts';

const base = new URL('../', import.meta.url);

// Load the route with its server imports replaced by fakes.
const source = readFileSync(new URL('app/api/me/route.ts', base), 'utf8')
  .replace("import { deleteVault } from '@/lib/vault-store';", "const deleteVault = async (_db, owner) => { globalThis.__vaultDeleted.push(owner); };")
  .replace("import { db, failure, identity, vaultDb } from '@/lib/server';", `
const db = () => globalThis.__meDB;
const vaultDb = () => ({ vault: true });
const identity = async (req, write) => {
  globalThis.__identityCalls.push(write);
  if (globalThis.__meUser === null) { const e = new Error('Sign in to access your portfolio.'); e.status = 401; throw e; }
  if (write && req.headers.get('origin') !== new URL(req.url).origin) { const e = new Error('Invalid request origin.'); e.status = 403; throw e; }
  return globalThis.__meUser;
};
const failure = (e, status) => Response.json({ error: e.message }, { status: status ?? e.status ?? 500 });`)
  .replace("import { getViewer } from '@/lib/auth';", 'const getViewer = async () => null;')
  .replace("import { UserError } from '@/lib/user-error';", `class UserError extends Error { constructor(m, status = 400) { super(m); this.status = status; } }`)
  .replace(/from '@\/lib\/([\w-]+)'/g, (_, name) => `from '${new URL(`lib/${name}.ts`, base).href}'`);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const route = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

function fakeDb() {
  const ran = [];
  return {
    ran,
    batches: 0,
    prepare(sql) {
      return { bind: (...args) => ({ sql, args }) };
    },
    async batch(statements) {
      this.batches++;
      ran.push(...statements);
      return statements.map(() => ({ success: true }));
    },
  };
}
const del = (body, origin = 'https://app.test') =>
  new Request('https://app.test/api/me', {
    method: 'DELETE',
    headers: { origin, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
function setup(user = 'owner@example.com') {
  globalThis.__meDB = fakeDb();
  globalThis.__meUser = user;
  globalThis.__identityCalls = [];
  globalThis.__vaultDeleted = [];
  return globalThis.__meDB;
}

test('every table in db/schema.ts is either cleared for the user or listed as shared', () => {
  const schema = readFileSync(new URL('db/schema.ts', base), 'utf8');
  const tables = [...schema.matchAll(/sqliteTable\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(tables.length >= 14);
  const handled = new Set([
    ...USER_TABLES.map((t) => t.table),
    ...CHILD_TABLES.map((t) => t.table),
    ...SHARED_TABLES,
  ]);
  for (const table of tables) assert.ok(handled.has(table), `${table} is neither deleted per user nor marked shared`);
  for (const table of handled) assert.ok(tables.includes(table), `${table} is not in db/schema.ts`);
  const cleared = new Set([...USER_TABLES, ...CHILD_TABLES].map((t) => t.table));
  for (const shared of SHARED_TABLES) assert.ok(!cleared.has(shared), `${shared} must not be cleared`);
});

test('the user columns exist on their tables', () => {
  const schema = readFileSync(new URL('db/schema.ts', base), 'utf8');
  const starts = [...schema.matchAll(/sqliteTable\(\s*'([a-z_]+)'/g)].map((m) => ({ name: m[1], at: m.index }));
  for (const { table, column } of USER_TABLES) {
    const i = starts.findIndex((s) => s.name === table);
    const block = schema.slice(starts[i].at, starts[i + 1]?.at ?? schema.length);
    assert.ok(block.includes(`'${column}'`), `${table}.${column}`);
  }
});

test('statements delete child rows before their parents, each with one bound email', () => {
  const sql = accountDeletionStatements();
  assert.equal(sql.length, USER_TABLES.length + CHILD_TABLES.length);
  for (const s of sql) assert.equal(s.match(/\?/g)?.length, 1, s);
  assert.ok(sql.findIndex((s) => s.includes('FROM recommendation_attempts')) < sql.findIndex((s) => s.startsWith('DELETE FROM monthly_recommendations')));
  assert.ok(sql.findIndex((s) => s.includes('FROM research_events')) < sql.findIndex((s) => s.startsWith('DELETE FROM research_jobs')));
  for (const shared of SHARED_TABLES) assert.ok(!sql.some((s) => s.startsWith(`DELETE FROM ${shared}`)), shared);
});

test('confirmationMatches needs the exact email, ignoring case and spaces', () => {
  assert.equal(confirmationMatches(' Owner@Example.com ', 'owner@example.com'), true);
  assert.equal(confirmationMatches('other@example.com', 'owner@example.com'), false);
  assert.equal(confirmationMatches('', 'owner@example.com'), false);
  assert.equal(confirmationMatches(undefined, 'owner@example.com'), false);
  assert.equal(confirmationMatches(42, 'owner@example.com'), false);
});

test('DELETE /api/me clears only the signed-in user in one batch and expires the cookie', async () => {
  const database = setup('Owner@Example.com');
  const res = await route.DELETE(del({ confirm: 'owner@example.com' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { deleted: true });
  assert.match(res.headers.get('set-cookie') ?? '', /session=;.*Max-Age=0/);
  assert.deepEqual(globalThis.__identityCalls, [true], 'must go through identity(req, true)');
  assert.equal(database.batches, 1);
  assert.deepEqual(globalThis.__vaultDeleted, ['owner@example.com'], 'the encrypted vault is deleted too');
  assert.equal(database.ran.length, accountDeletionStatements().length);
  for (const { args } of database.ran) assert.deepEqual(args, ['owner@example.com']);
  const tables = database.ran.map((s) => s.sql);
  for (const t of USER_TABLES) assert.ok(tables.some((s) => s.startsWith(`DELETE FROM ${t.table} `)), t.table);
  for (const t of SHARED_TABLES) assert.ok(!tables.some((s) => s.includes(t)), t);
});

test('DELETE /api/me refuses without the right confirmation and touches nothing', async () => {
  const database = setup();
  for (const body of [undefined, {}, { confirm: '' }, { confirm: 'someone@else.com' }, { confirm: true }]) {
    const res = await route.DELETE(del(body));
    assert.equal(res.status, 400);
  }
  assert.equal(database.batches, 0);
  assert.deepEqual(globalThis.__vaultDeleted, [], 'nothing is deleted without the confirmation');
});

test('DELETE /api/me rejects a cross-origin cookie request and an unsigned-in caller', async () => {
  const database = setup();
  const cross = await route.DELETE(del({ confirm: 'owner@example.com' }, 'https://evil.test'));
  assert.equal(cross.status, 403);
  setup(null);
  const anon = await route.DELETE(del({ confirm: 'owner@example.com' }));
  assert.equal(anon.status, 401);
  assert.equal(database.batches, 0);
  assert.equal(globalThis.__meDB.batches, 0);
});
