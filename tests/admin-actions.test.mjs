import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { cleanDetail, pruneJobRuns, recentJobRuns, recordJobRun } from '../lib/job-runs.ts';
import { parseAction, recentAdminActions, runAdminAction } from '../lib/admin-actions.ts';
import { adminHealth } from '../lib/admin-health.ts';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../drizzle/', import.meta.url)).filter((n) => n.endsWith('.sql')).sort())
    sqlite.exec(readFileSync(new URL(`../drizzle/${f}`, import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  });
  return { sqlite, prepare: (sql) => stmt(sql) };
}

test('job run messages are shortened and stripped of credentials and query strings', () => {
  assert.equal(cleanDetail(null), null);
  assert.match(cleanDetail('Authorization: Bearer abcdef123456789 failed'), /hidden/);
  assert.doesNotMatch(cleanDetail('GET https://x.com/a?token=abcdef123456&b=2 failed'), /abcdef/);
  assert.equal(cleanDetail('x'.repeat(900)).length, 300);
  assert.equal(cleanDetail(new Error('boom')), 'boom');
});

test('job runs are stored newest first, filtered by job, and pruned after 90 days', async () => {
  const db = d1();
  await recordJobRun(db, { job: 'quotes', source: 'github', startedAt: '2026-10-14T06:00:00Z', finishedAt: '2026-10-14T06:01:00Z', ok: true });
  await recordJobRun(db, { job: 'quotes', source: 'cron', startedAt: '2026-10-14T06:05:00Z', finishedAt: '2026-10-14T06:05:01Z', ok: false, detail: 'GitHub answered 401' });
  await recordJobRun(db, { job: 'facts', source: 'github', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:00Z', ok: true });
  const quotes = await recentJobRuns(db, 'quotes');
  assert.deepEqual(quotes.map((r) => [r.source, r.ok]), [['cron', false], ['github', true]]);
  assert.equal((await recentJobRuns(db)).length, 3);
  await pruneJobRuns(db, new Date('2026-10-14T00:00:00Z'));
  assert.equal((await recentJobRuns(db)).length, 2);
});

test('a failed latest run turns a pipeline late until a newer success, and a clean run proves it is alive', async () => {
  const db = d1();
  const now = new Date('2026-10-14T07:00:00Z');
  db.sqlite.prepare("INSERT INTO quote_refreshes (ticker,price,as_of,quote_date,source,fetched_at,updated_at) VALUES ('MEBL',1,'x','2026-10-14','s','2026-10-14T06:50:00Z','2026-10-14T06:50:00Z')").run();
  await recordJobRun(db, { job: 'quotes', source: 'cron', startedAt: '2026-10-14T06:55:00Z', finishedAt: '2026-10-14T06:55:01Z', ok: false, detail: 'Could not start psx-quotes.yml' });
  let row = (await adminHealth(db, { now })).pipelines.find((p) => p.id === 'quotes');
  assert.equal(row.status, 'late');
  assert.match(row.lastError, /Could not start/);
  assert.equal(row.lastRun.ok, false);
  await recordJobRun(db, { job: 'quotes', source: 'github', startedAt: '2026-10-14T06:58:00Z', finishedAt: '2026-10-14T06:59:00Z', ok: true });
  row = (await adminHealth(db, { now })).pipelines.find((p) => p.id === 'quotes');
  assert.equal(row.status, 'ok');
  assert.equal(row.lastError, null);
  await recordJobRun(db, { job: 'metals', source: 'github', startedAt: '2026-10-14T05:00:00Z', finishedAt: '2026-10-14T05:00:30Z', ok: true });
  assert.equal((await adminHealth(db, { now })).pipelines.find((p) => p.id === 'metals').status, 'ok');
});

test('only allowlisted actions parse', () => {
  assert.deepEqual(parseAction({ action: 'run-workflow', workflow: 'psx-quotes.yml' }), { action: 'run-workflow', workflow: 'psx-quotes.yml' });
  assert.equal(parseAction({ action: 'run-workflow', workflow: 'deploy.yml' }), null);
  assert.equal(parseAction({ action: 'run-workflow', workflow: '../x' }), null);
  assert.equal(parseAction({ action: 'drop-tables' }), null);
  assert.equal(parseAction(null), null);
  assert.deepEqual(parseAction({ action: 'retry-stuck' }), { action: 'retry-stuck' });
});

test('actions are logged, staging never starts workflows, and retry/cancel touch only stuck requests', async () => {
  const db = d1();
  const now = new Date('2026-10-14T07:00:00Z');
  const ins = (t, status, at) => db.sqlite.prepare('INSERT INTO refresh_requests (kind,ticker,status,requested_at,attempts) VALUES (?,?,?,?,1)').run('history', t, status, at);
  ins('OGDC', 'queued', '2026-10-14T06:00:00Z'); ins('LUCK', 'running', '2026-10-14T06:10:00Z'); ins('MEBL', 'queued', '2026-10-14T06:55:00Z'); ins('PSO', 'completed', '2026-10-14T05:00:00Z');
  const staging = await runAdminAction(db, 'me@x.com', { action: 'run-workflow', workflow: 'psx-quotes.yml' }, { token: 't', repo: 'a/b', appEnv: 'staging' }, now);
  assert.equal(staging.ok, false);
  const retry = await runAdminAction(db, 'me@x.com', { action: 'retry-stuck' }, {}, now);
  assert.match(retry.message, /^2 stuck requests queued again/);
  assert.equal(db.sqlite.prepare("SELECT status FROM refresh_requests WHERE ticker='MEBL'").get().status, 'queued');
  assert.equal(db.sqlite.prepare("SELECT status FROM refresh_requests WHERE ticker='PSO'").get().status, 'completed');
  const cancel = await runAdminAction(db, 'me@x.com', { action: 'cancel-stuck' }, {}, new Date('2026-10-14T07:30:00Z'));
  assert.match(cancel.message, /^3 stuck requests cancelled/);
  const log = await recentAdminActions(db);
  assert.deepEqual(log.map((l) => l.action), ['cancel-stuck', 'retry-stuck', 'run-workflow']);
  assert.equal(log[0].actor, 'me@x.com');
});
