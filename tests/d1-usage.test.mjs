// Guards the account-wide D1 free limit (5M rows read and 100k rows written a day, shared by production and staging).
// A query that scans a table that keeps growing costs rows on every run; the admin and alert queries on `analytics_events`
// did exactly that on 2026-10-22 and took the app down. This test plans every SELECT in the server code against the real
// migrations and fails when one scans a growing table, unless it is listed below with the reason it is acceptable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createD1 } from './helpers/d1.mjs';
import { catalogRowParams, catalogUpsertSql } from '../lib/security-catalog.ts';
import { purgeStagingEvents } from '../lib/analytics-store.ts';

const ROOT = new URL('..', import.meta.url).pathname;

/** Tables whose size grows with time or users, so a scan of one costs more every month. */
const GROWING = [
  'analytics_events', 'job_runs', 'server_errors', 'fund_navs', 'plan_navs', 'fx_rates', 'metal_rates', 'ai_usage',
  'ai_research_runs', 'feedback', 'mobile_sessions', 'dividend_announcements', 'notifications', 'rate_limits',
];

/**
 * Scans that are accepted: [SQL fragment, why]. Keep this list short. Add to it only when the table is small by
 * design or the answer is cached and rarely asked for, and say which.
 */
const ACCEPTED = [
  ['FROM plan_navs WHERE date>=?', 'edge-cached for an hour (app/api/public-data/plan-navs); about 3,500 rows by design'],
  ['FROM server_errors WHERE minute>=?', 'Platform page: one row per route and minute that had a 5xx, pruned at 30 days'],
  ['FROM feedback', 'admin Feedback page only; the table holds a handful of rows (purged after retention)'],
  ['FROM ai_usage', 'admin spend summary only; one row per AI call, a few hundred a month, cached two minutes'],
  ['FROM ai_research_runs', 'admin spend summary only; one row per AI Lab run, cached two minutes'],
  ['FROM mobile_sessions m JOIN user_roles', 'alert push targets: one row per signed-in phone, sent once a day per issue'],
  ['FROM analytics_events WHERE user_key IS NOT NULL', 'People/Usage reports: per-user rollup over the 180-day retention, admin only, cached two minutes, polling stops when idle'],
  ['COUNT(DISTINCT session_id) AS sessions', 'People report, see above'],
  ['FROM analytics_events WHERE day>=?', 'Usage report: bounded by the day range, admin only, cached two minutes'],
  ['FROM analytics_events WHERE event IN', 'People milestones, see above'],
  ['SELECT event, platform, COUNT(*) AS n', 'Usage report, see above'],
];

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|mjs)$/.test(name)) out.push(path);
    }
  };
  walk(join(ROOT, 'lib'));
  walk(join(ROOT, 'app/api'));
  out.push(join(ROOT, 'workers/quote-refresh/src/index.ts'));
  return out.filter((f) => !f.includes('/test-seed/'));
}

function selects(src) {
  const found = [];
  const re = /(['"`])((?:SELECT|WITH)[\s\S]*?)\1/g;
  let m;
  while ((m = re.exec(src))) {
    const sql = m[2]
      .replace(/IN \(\$\{[^}]*\}\)/g, 'IN (?)')
      .replace(/\$\{[^}]*\}/g, (x) => (/INTERNAL|SERVER_EVENTS/.test(x) ? "('x')" : ' '));
    if (/\bFROM\b/i.test(sql)) found.push(sql);
  }
  return found;
}

test('no SELECT scans a growing table unless it is on the accepted list', () => {
  const db = createD1();
  const offenders = [];
  let planned = 0;
  for (const file of sourceFiles()) {
    for (const sql of selects(readFileSync(file, 'utf8'))) {
      const placeholders = (sql.match(/\?/g) ?? []).length;
      let plan;
      try {
        plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(placeholders).fill(null));
      } catch {
        continue; // dynamic SQL this test cannot assemble
      }
      planned += 1;
      const flat = sql.replace(/\s+/g, ' ');
      for (const row of plan) {
        const scan = /^SCAN (\w+)/.exec(row.detail);
        // A range-only search on the first indexed column (`user_key IS NOT NULL`, `day>=?`) reads every matching row.
        const range = /^SEARCH (\w+) USING (?:COVERING )?INDEX \w+ \((?:user_key|day|ts|fetched_at|created_at)[<>]\?\)$/.exec(row.detail);
        const table = (scan ?? range)?.[1];
        if (!table || !GROWING.includes(table)) continue;
        if (ACCEPTED.some(([fragment]) => flat.includes(fragment))) continue;
        offenders.push(`${file.replace(ROOT, '')}: ${row.detail}\n    ${flat.slice(0, 160)}`);
      }
    }
  }
  assert.ok(planned > 100, `only ${planned} queries were planned: the extractor stopped finding SQL`);
  assert.deepEqual(offenders, [], `These queries scan a growing table (add an index, or list them in ACCEPTED with the reason):\n${offenders.join('\n')}`);
});

test('the alert and admin event counts use the event index', () => {
  const db = createD1();
  const plan = (sql, ...args) => db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((r) => r.detail).join(' | ');
  assert.match(
    plan("SELECT COUNT(*) AS n FROM analytics_events WHERE event='client_error' AND is_admin=0 AND ts>=? AND ts<?", 'a', 'b'),
    /SEARCH analytics_events USING (COVERING )?INDEX analytics_events_event_ts_idx \(event=\? AND ts>\? AND ts<\?\)/,
  );
  assert.match(plan('SELECT MAX(fetched_at) AS t FROM metal_rates'), /USING (COVERING )?INDEX metal_rates_fetched_idx/);
});

test('staging analytics cleanup removes old rows a chunk at a time and keeps today', async () => {
  const db = createD1();
  const insert = db.sqlite.prepare("INSERT INTO analytics_events (ts,day,session_id,platform,event,is_admin) VALUES (?,?,?,?,?,0)");
  for (let i = 0; i < 5; i += 1) insert.run('2026-10-20T00:00:00Z', '2026-10-20', 's', 'web', 'app_opened');
  insert.run('2026-10-22T10:00:00Z', '2026-10-22', 's', 'web', 'app_opened');
  const now = new Date('2026-10-22T12:00:00Z');
  await purgeStagingEvents(db, now, 3);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n, 3, 'one chunk of 3 old rows is gone');
  await purgeStagingEvents(db, now, 3);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM analytics_events').get().n, 1, 'the rest of the old rows, not today');
});

test('the catalog upsert does not rewrite an unchanged security on every scrape', () => {
  const db = createD1();
  const put = (name, at) => Number(db.sqlite.prepare(catalogUpsertSql(1)).run(...catalogRowParams({ ticker: 'AAA', name }, 'src', at)).changes);
  assert.equal(put('Alpha Ltd', '2026-10-22T05:00:00Z'), 1, 'first sight is stored');
  assert.equal(put('Alpha Ltd', '2026-10-22T05:05:00Z'), 0, 'the next scrape five minutes later writes nothing');
  assert.equal(put('Alpha Ltd', '2026-10-22T10:00:00Z'), 0, 'still nothing within six hours');
  assert.equal(put('Alpha Ltd', '2026-10-22T11:30:00Z'), 1, 'last_seen_at moves after six hours');
  assert.equal(put('Alpha Limited', '2026-10-22T11:35:00Z'), 1, 'a changed name is stored at once');
});
