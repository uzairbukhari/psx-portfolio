import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { adminHealth, spendCaps } from '../lib/admin-health.ts';
import { buildAttention, delta } from '../lib/admin-overview.ts';
import { overviewMetrics, insertEvents, userKey } from '../lib/analytics-store.ts';

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
  return { sqlite, prepare: (sql) => stmt(sql), batch: async (list) => list.map((s) => s.exec()) };
}

const now = new Date('2026-10-14T07:00:00Z'); // Wednesday, market open

test('admin health rates every pipeline from its own table and surfaces failures, queues and AI spend', async () => {
  const db = d1();
  const run = (sql, ...a) => db.sqlite.prepare(sql).run(...a);
  run("INSERT INTO quote_refreshes (ticker,price,as_of,quote_date,source,fetched_at,updated_at) VALUES ('MEBL',1,'x','2026-10-14','s','2026-10-14T06:55:00Z','2026-10-14T06:55:00Z')");
  run("INSERT INTO company_facts (ticker,fetched_on,payload,fetched_at) VALUES ('MEBL','2026-10-08','{}','2026-10-08T12:00:00Z')");
  run("INSERT INTO facts_requests (ticker,requested_at,attempted_at,error) VALUES ('LUCK','2026-10-14T05:00:00Z','2026-10-14T05:05:00Z','PSX answered 520')");
  run("INSERT INTO refresh_requests (kind,ticker,status,requested_at,attempts) VALUES ('history','OGDC','queued','2026-10-14T06:00:00Z',1)");
  run("INSERT INTO ai_research_runs (id,started_at,status,provider,models,cost_usd) VALUES ('r1','2026-10-03T04:00:00Z','completed','openai','m',1.5)");
  run("INSERT INTO ai_research_runs (id,started_at,status,provider,models,cost_usd) VALUES ('r2','2026-10-05T04:00:00Z','completed','openai','face-value:m',0.9)");
  const health = await adminHealth(db, { now, faceValueCapUsd: 1 });
  const by = Object.fromEntries(health.pipelines.map((p) => [p.id, p]));
  assert.equal(by.quotes.status, 'ok');
  assert.equal(by.facts.status, 'failing'); // five weekdays old
  assert.equal(by.facts.lastError, 'PSX answered 520');
  assert.equal(by.metals.status, 'failing'); // required and never stored
  assert.equal(by['ai-research'].status, 'ok');
  assert.equal(by.history.status, 'idle'); // optional and never stored
  assert.equal(health.queues.stuckCount, 1);
  assert.equal(health.queues.stuck[0].ticker, 'OGDC');
  assert.deepEqual(health.aiSpend.sources.map((s) => [s.id, s.usd]), [['research-desk', 0], ['ai-lab', 1.5], ['face-value', 0.9]]);
  assert.equal(health.aiSpend.months.at(-1).usd, 2.4);
  const attention = buildAttention(health, await overviewMetrics(db, false, now, []));
  assert.equal(attention[0].level, 'failing');
  assert.ok(attention.some((a) => /Company facts/.test(a.text)));
  assert.ok(attention.some((a) => /Face-value finder is at 90%/.test(a.text)));
  assert.ok(attention.some((a) => /queued over 15 minutes/.test(a.text)));
});

test('overview metrics compare today with a week ago and leave internal accounts out', async () => {
  const db = d1();
  const secret = 'sec';
  const real = await userKey('real@x.com', secret);
  const tester = await userKey('tester@x.com', secret);
  for (const [key, when] of [[real, '2026-10-14T05:00:00Z'], [real, '2026-10-07T05:00:00Z'], [tester, '2026-10-14T05:30:00Z']])
    await insertEvents(db, { sessionId: `s-${key}-${when}`, userKey: key, platform: 'web' }, [{ event: 'screen_viewed', props: { screen: 'reports' } }, { event: 'client_error', props: { area: 'import', code: 'pdf_unrecognized' } }], new Date(when));
  const m = await overviewMetrics(db, false, now, [tester]);
  assert.equal(m.activeToday, 1);
  assert.equal(m.activeLastWeek, 1);
  assert.equal(m.errors24h, 1);
  assert.deepEqual(m.topError, { area: 'import', code: 'pdf_unrecognized', n: 1, before: 0 });
  assert.equal(m.dailyActive.length, 30);
  assert.equal((await overviewMetrics(db, true, now, [tester])).activeToday, 2);
});

test('delta and spending caps', () => {
  assert.deepEqual(delta(5, 3), { sign: 'up', amount: 2 });
  assert.deepEqual(delta(2, 2), { sign: 'flat', amount: 0 });
  assert.deepEqual(spendCaps({}), { aiLabCapUsd: null, faceValueCapUsd: null });
  assert.deepEqual(spendCaps({ AI_RESEARCH_MONTHLY_CAP_USD: '5', FACE_VALUE_AI_MONTHLY_CAP_USD: '2' }), { aiLabCapUsd: 5, faceValueCapUsd: 2 });
});
