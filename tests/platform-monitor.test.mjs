import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { classifyServerError, pruneServerErrors, recordServerError, routeLabel, serverErrorSummary } from '../lib/server-errors.ts';
import { parseWorkerDay, storeWorkerDay, syncPlatformMetrics } from '../lib/cf-analytics.ts';
import { judgePlatform, platformLimits, platformReport } from '../lib/admin-platform.ts';
import { insertEvents } from '../lib/analytics-store.ts';

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
const now = new Date('2026-10-14T07:30:00Z');

test('server errors are classified and routes collapse ids', () => {
  assert.equal(classifyServerError(new Error('Worker exceeded CPU time limit'), 500), 'worker_limit');
  assert.equal(classifyServerError(new Error('D1_ERROR: no such table: x'), 500), 'db_error');
  assert.equal(classifyServerError(new Error('The operation was aborted due to timeout'), 500), 'timeout');
  assert.equal(classifyServerError(null, 503), 'upstream');
  assert.equal(classifyServerError(new Error('boom'), 500), 'server_error');
  assert.equal(routeLabel('https://x.com/api/v3/portfolio?x=1'), '/api/v3/portfolio');
  assert.equal(routeLabel('https://x.com/api/jobs/12345/steps'), '/api/jobs/:id/steps');
  assert.equal(routeLabel('not a url'), '/not%20a%20url');
});

test('a burst on one route is one row with a count; summary and pruning work', async () => {
  const db = d1();
  for (let i = 0; i < 40; i += 1) await recordServerError(db, '/api/quotes', 'db_error', 500, now);
  await recordServerError(db, '/api/quotes', 'db_error', 500, new Date(now.getTime() + 61_000));
  await recordServerError(db, '/api/me', 'server_error', 500, new Date(now.getTime() - 30 * 3_600_000));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS c FROM server_errors').get().c, 3);
  const sum = await serverErrorSummary(db, new Date(now.getTime() + 120_000));
  assert.equal(sum.last24h, 41);
  assert.equal(sum.previous24h, 1);
  assert.equal(sum.lastHour, 41);
  assert.deepEqual({ ...sum.byRoute[0] }, { route: '/api/quotes', code: 'db_error', n: 41, lastAt: '2026-10-14T07:31' });
  await pruneServerErrors(db, new Date('2026-12-14T00:00:00Z'));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS c FROM server_errors').get().c, 0);
});

const gql = (groups) => ({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: groups }] } } });

test('Cloudflare analytics groups fold into one day, counting limit statuses whatever they are called', () => {
  const day = parseWorkerDay(gql([
    { sum: { requests: 900 }, quantiles: { cpuTimeP50: 2000, cpuTimeP99: 7000 }, dimensions: { status: 'success' } },
    { sum: { requests: 50 }, quantiles: { cpuTimeP50: 1000, cpuTimeP99: 9000 }, dimensions: { status: 'clientDisconnected' } },
    { sum: { requests: 30 }, quantiles: { cpuTimeP50: 0, cpuTimeP99: 9500 }, dimensions: { status: 'exceededCpu' } },
    { sum: { requests: 5 }, quantiles: {}, dimensions: { status: 'scriptThrewException' } },
  ]));
  assert.equal(day.requests, 985);
  assert.equal(day.errors, 35);
  assert.equal(day.limitHits, 30);
  assert.equal(day.cpuP99, 9500);
  assert.equal(day.statuses.exceededCpu, 30);
  assert.equal(parseWorkerDay({ errors: [{ message: 'denied' }] }), null);
});

test('syncing stores nothing without a token and converts microseconds with one', async () => {
  const db = d1();
  assert.equal(await syncPlatformMetrics(db, {}, ['w'], now, async () => { throw Error('no call'); }), 0);
  const fetcher = async (_u, init) => {
    assert.match(JSON.parse(init.body).variables.script, /^w/);
    return Response.json(gql([{ sum: { requests: 10 }, quantiles: { cpuTimeP50: 3000, cpuTimeP99: 8000 }, dimensions: { status: 'success' } }]));
  };
  assert.equal(await syncPlatformMetrics(db, { token: 't', accountId: 'a' }, ['w1', 'w2'], now, fetcher), 2);
  const row = db.sqlite.prepare("SELECT * FROM platform_metrics WHERE script='w1'").get();
  assert.equal(row.day, '2026-10-14');
  assert.equal(row.cpu_p99, 8);
  assert.equal(await syncPlatformMetrics(db, { token: 't', accountId: 'a' }, ['w'], now, async () => new Response('x', { status: 403 })), 0);
});

test('the platform report judges limits, server errors and counts what browsers saw', async () => {
  const db = d1();
  let r = await platformReport(db, { now });
  assert.equal(r.status, 'idle');
  assert.equal(r.connected, false);
  await storeWorkerDay(db, 'psx-portfolio-sip', { requests: 85_000, errors: 0, limitHits: 0, cpuP50: 2, cpuP99: 5, statuses: { success: 85000 } }, now);
  r = await platformReport(db, { now });
  assert.equal(r.status, 'late');
  assert.match(r.headline, /85%/);
  await storeWorkerDay(db, 'psx-portfolio-sip', { requests: 85_000, errors: 12, limitHits: 12, cpuP50: 2, cpuP99: 5, statuses: { success: 84988, exceededCpu: 12 } }, now);
  r = await platformReport(db, { now });
  assert.equal(r.status, 'failing');
  assert.match(r.headline, /12 requests hit a Cloudflare limit/);
  await insertEvents(db, { sessionId: 'sess-1', userKey: 'a'.repeat(32), platform: 'web' }, [{ event: 'client_error', props: { area: 'platform', code: 'cf_worker_limit' } }], now);
  r = await platformReport(db, { now });
  assert.deepEqual(r.client.map((c) => ({ ...c })), [{ code: 'cf_worker_limit', n: 1 }]);
  assert.equal(judgePlatform({ connected: true, dailyRequestLimit: 100, cpuLimitMs: 10, today: { requests: 1, errors: 0, limitHits: 0, cpuP99: 9, usedShare: 0.01, scripts: [] }, server: { last24h: 0, previous24h: 0, lastHour: 0, byRoute: [], series: [] } }).status, 'late');
  assert.deepEqual(platformLimits({ CF_DAILY_REQUEST_LIMIT: '5000000' }), { dailyRequestLimit: 5_000_000, cpuLimitMs: 10 });
});
