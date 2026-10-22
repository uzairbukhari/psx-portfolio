import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1.mjs';
import { d1Level, isBrownout, meterFrom, parseD1Day, readD1Days, setBrownout, syncD1Usage } from '../lib/d1-usage.ts';
import { dueWorkflows } from '../lib/scrape-schedule.ts';
import { alertsFrom } from '../lib/admin-alerts.ts';
import { platformReport } from '../lib/admin-platform.ts';

const response = (groups) => ({ data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: groups }] } } });
const fetcher = (groups, ok = true) => async () => new Response(JSON.stringify(ok ? response(groups) : { errors: [{ message: 'nope' }] }), { status: ok ? 200 : 403 });
const group = (id, reads, writes) => ({ sum: { rowsRead: reads, rowsWritten: writes }, dimensions: { databaseId: id } });
const settings = { token: 't', accountId: 'a' };

test('parseD1Day adds the databases up and keeps each one', () => {
  const day = parseD1Day(response([group('prod', 1_000_000, 500), group('staging', 3_000_000, 1500), group('prod', 10, 0)]));
  assert.equal(day.reads, 4_000_010);
  assert.equal(day.writes, 2000);
  assert.deepEqual(day.byDb.prod, { reads: 1_000_010, writes: 500 });
  assert.equal(parseD1Day({ data: null }), null);
});

test('levels start at 50, 80 and 95 percent and the worse of reads and writes counts', () => {
  assert.deepEqual([0.1, 0.5, 0.8, 0.95].map(d1Level), ['ok', 'notice', 'warn', 'critical']);
  const m = meterFrom({ day: '2026-10-22', reads: 1_000_000, writes: 85_000, fetched_at: 'x' });
  assert.equal(m.level, 'warn');
  assert.equal(m.readShare, 0.2);
});

test('syncing stores today, switches the brownout on at 80 percent and off again, and stores nothing on an error', async () => {
  const db = createD1();
  const now = new Date('2026-10-22T10:00:00Z');
  const bad = await syncD1Usage(db, settings, now, fetcher([], false));
  assert.match(bad.error, /403|Account Analytics/);
  assert.equal((await readD1Days(db, now)).length, 0);

  const calm = await syncD1Usage(db, settings, now, fetcher([group('prod', 900_000, 100)]));
  assert.equal(calm.meter.level, 'ok');
  assert.equal(await isBrownout(db, now), false);

  const hot = await syncD1Usage(db, settings, now, fetcher([group('prod', 4_200_000, 100)]));
  assert.equal(hot.meter.level, 'warn');
  assert.equal(await isBrownout(db, now), true);
  assert.equal((await readD1Days(db, now)).length, 1, 'one row per day');
  assert.equal(await isBrownout(db, new Date('2026-10-23T00:05:00Z')), false, 'it ends by itself at 00:00 UTC');

  await syncD1Usage(db, settings, now, fetcher([group('prod', 1_000_000, 100)]));
  assert.equal(await isBrownout(db, now), false, 'and it switches off when usage drops (a counter reset or correction)');
});

test('without the token nothing is fetched', async () => {
  const result = await syncD1Usage(createD1(), {}, new Date(), async () => { throw new Error('no fetch expected'); });
  assert.match(result.error, /not set/);
});

test('a brownout slows quotes to every 15 minutes and history to hourly, and leaves the post-close run alone', () => {
  const at = (h, m) => new Date(Date.UTC(2026, 9, 22, h, m)); // a Thursday
  const names = (when, brownout) => dueWorkflows(when, brownout).map((d) => d.workflow.replace('psx-', '').replace('.yml', ''));
  assert.deepEqual(names(at(6, 5), false), ['quotes']);
  assert.deepEqual(names(at(6, 5), true), []);
  assert.deepEqual(names(at(6, 15), true), ['quotes']);
  assert.deepEqual(names(at(6, 30), false), ['quotes', 'history']);
  assert.deepEqual(names(at(6, 30), true), ['quotes']);
  assert.deepEqual(names(at(7, 0), true), ['quotes', 'history']);
  assert.deepEqual(names(at(12, 10), true), ['history'], 'the final daily close still runs');
});

test('alerts: one per level, nothing while ok', () => {
  const health = { pipelines: [] };
  const platform = { status: 'ok', today: { limitHits: 0, usedShare: 0 }, connected: true, server: { lastHour: 0 } };
  const errors = { errors24h: 0, errorsPrev24h: 0 };
  const keys = (d1) => alertsFrom(health, platform, errors, d1).map((a) => a.key);
  assert.deepEqual(keys(null), []);
  assert.deepEqual(keys({ level: 'ok', readShare: 0.1, writeShare: 0 }), []);
  assert.deepEqual(keys({ level: 'notice', readShare: 0.55, writeShare: 0 }), ['d1:notice']);
  assert.deepEqual(keys({ level: 'warn', readShare: 0.82, writeShare: 0 }), ['d1:warn']);
  assert.deepEqual(keys({ level: 'critical', readShare: 0.97, writeShare: 0 }), ['d1:warn']);
});

test('the platform report carries the D1 meter, the brownout and a headline when it is high', async () => {
  const db = createD1();
  const now = new Date('2026-10-22T10:30:00Z');
  await syncD1Usage(db, settings, now, fetcher([group('prod', 4_300_000, 10)]));
  const report = await platformReport(db, { now });
  assert.equal(report.d1.meter.level, 'warn');
  assert.equal(report.d1.brownout, true);
  assert.equal(report.status, 'late');
  assert.match(report.headline, /D1 is at 86%/);
  await setBrownout(db, false, now);
  assert.equal((await platformReport(db, { now })).d1.brownout, false);
});
