import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRows } from '../lib/analytics-rows.ts';
import { sessionize, sessionStats } from '../lib/analytics-sessions.ts';
import { funnel, parseStep, paths, timeToMilestones } from '../lib/analytics-journey.ts';
import { activeSeries, dailyCohorts, featureAdoption, lifecycle, powerCurve, snapshotMix } from '../lib/analytics-engagement.ts';
import { audienceMix, sources, versionAdoption } from '../lib/analytics-acquisition.ts';
import { errorRates, errorsByScreen, qualitySeries, timings, vitals } from '../lib/analytics-quality.ts';
import { buildLens, windows } from '../lib/analytics-lenses.ts';

/** A synthetic event row; `at` is an ISO instant, the day is its PKT date. */
function row(user, at, event, props = {}, extra = {}) {
  const ts = new Date(at).toISOString();
  const day = new Date(Date.parse(ts) + 5 * 3_600_000).toISOString().slice(0, 10);
  return { ts, day, userKey: user, sessionId: extra.session ?? `${user}-s`, platform: extra.platform ?? 'web', appVersion: extra.version ?? null, event, props,
    country: extra.country ?? null, os: extra.os ?? null, browser: extra.browser ?? null, formFactor: extra.formFactor ?? null };
}
const screen = (user, at, name, extra) => row(user, at, 'screen_viewed', { screen: name }, extra);

test('sessions split after 30 idle minutes and report length, depth and bounce', () => {
  const rows = [
    screen('a', '2026-10-01T05:00:00Z', 'holdings'), screen('a', '2026-10-01T05:02:00Z', 'reports'), row('a', '2026-10-01T05:05:00Z', 'entry_added', { kind: 'buy' }),
    screen('a', '2026-10-01T06:00:00Z', 'holdings'), // 55 minutes later: a new visit, a bounce
  ];
  const s = sessionize(rows);
  assert.equal(s.length, 2);
  assert.deepEqual(s[0].screens, ['holdings', 'reports']);
  assert.equal(s[0].end - s[0].start, 5 * 60_000);
  const stats = sessionStats(s);
  assert.equal(stats.sessions, 2);
  assert.equal(stats.bounceRate, 0.5);
  assert.equal(stats.entry[0].key, 'holdings');
  assert.equal(stats.duration.find((d) => d.bucket === '3–10 min').n, 1);
});

test('funnel steps must happen in order and inside the window', () => {
  const rows = [
    row('a', '2026-10-01T05:00:00Z', 'signed_up', { platform: 'web' }), row('a', '2026-10-01T05:10:00Z', 'vault_created'), row('a', '2026-10-02T05:00:00Z', 'entry_added', { kind: 'buy' }),
    row('b', '2026-10-01T05:00:00Z', 'vault_created'), row('b', '2026-10-01T06:00:00Z', 'signed_up', { platform: 'web' }), // vault before sign-up: not counted
    row('c', '2026-10-01T05:00:00Z', 'signed_up', { platform: 'web' }), row('c', '2026-10-01T05:01:00Z', 'vault_created'), row('c', '2026-10-20T05:00:00Z', 'import_completed', { source: 'ahl' }), // too late
  ];
  const f = funnel(rows, ['signed_up', 'vault_created', 'entry_added|import_completed'], 7);
  assert.deepEqual(f.map((s) => s.users), [3, 2, 1]);
  assert.equal(f[1].fromPrevious, 2 / 3);
  assert.equal(f[1].medianMsFromPrevious, 60_000); // nearest-rank median of 1 and 10 minutes
  assert.deepEqual(f[0].dropped, ['b']);
  assert.deepEqual(f[1].dropped, ['c']);
  assert.equal(parseStep('screen_viewed:screen=reports')[0].value, 'reports');
  assert.equal(parseStep('screen_viewed:screen=MEBL'), null);
  assert.equal(parseStep('made_up'), null);
  assert.throws(() => funnel(rows, ['nope'], 7));
});

test('paths show where people go after a screen, with exits and folded rare steps', () => {
  const rows = [
    screen('a', '2026-10-01T05:00:00Z', 'holdings'), screen('a', '2026-10-01T05:01:00Z', 'reports'),
    screen('b', '2026-10-01T05:00:00Z', 'holdings'), screen('b', '2026-10-01T05:01:00Z', 'reports'), screen('b', '2026-10-01T05:02:00Z', 'sip'),
    screen('c', '2026-10-01T05:00:00Z', 'holdings'),
  ];
  const g = paths(sessionize(rows), 'screen:holdings', 'next', 2);
  assert.equal(g.sessions, 3);
  const link = (s, t) => g.links.find((l) => l.source === s && l.target === t)?.value;
  assert.equal(link('0:screen:holdings', '1:screen:reports'), 2);
  assert.equal(link('0:screen:holdings', '1:exit'), 1);
  assert.equal(link('1:screen:reports', '2:screen:sip'), 1);
  const back = paths(sessionize(rows), 'screen:reports', 'prev', 1);
  assert.equal(back.links.find((l) => l.source === '0:screen:holdings' && l.target === '1:screen:reports').value, 2);
});

test('time to milestones runs from sign-up', () => {
  const rows = [
    row('a', '2026-10-01T05:00:00Z', 'signed_up', { platform: 'web' }), row('a', '2026-10-01T05:05:00Z', 'vault_created'),
    row('b', '2026-10-01T05:00:00Z', 'signed_up', { platform: 'web' }), row('b', '2026-10-03T05:00:00Z', 'vault_created'),
  ];
  const vault = timeToMilestones(rows).find((m) => m.id === 'vault');
  assert.equal(vault.started, 2);
  assert.equal(vault.reached, 2);
  assert.equal(vault.buckets[0].n, 1);
  assert.equal(vault.buckets[3].n, 1);
});

test('active series, power curve and weekly lifecycle', () => {
  const rows = [
    screen('a', '2026-09-29T05:00:00Z', 'holdings'), screen('a', '2026-10-06T05:00:00Z', 'holdings'), screen('a', '2026-10-07T05:00:00Z', 'holdings'),
    screen('b', '2026-09-29T05:00:00Z', 'holdings'), // churns after week 1
    screen('c', '2026-10-07T05:00:00Z', 'holdings'), // new in week 2
    screen('d', '2026-09-15T05:00:00Z', 'holdings'), screen('d', '2026-10-08T05:00:00Z', 'holdings'), // resurrected
  ];
  const series = activeSeries(rows, '2026-10-07', '2026-10-07');
  assert.deepEqual([series[0].dau, series[0].wau, series[0].mau], [2, 2, 4]); // d's 15 Sep is inside 28 days
  const curve = powerCurve(rows, '2026-10-08');
  assert.deepEqual([curve[0], curve[1], curve[2]], [2, 1, 1]); // b and c one day, d two, a three
  const weeks = lifecycle(rows, '2026-10-06', '2026-10-08');
  assert.deepEqual(weeks[0], { week: '2026-10-05', new: 1, returning: 1, resurrected: 1, churned: 1 });
});

test('daily cohorts, feature adoption and the account-size mix', () => {
  const rows = [
    screen('a', '2026-10-01T05:00:00Z', 'holdings'), screen('a', '2026-10-02T05:00:00Z', 'holdings'),
    screen('b', '2026-10-01T05:00:00Z', 'holdings'),
    row('a', '2026-10-01T05:00:00Z', 'entry_added', { kind: 'buy' }), row('a', '2026-10-02T05:00:00Z', 'entry_added', { kind: 'buy' }), row('b', '2026-10-01T05:00:00Z', 'entry_added', { kind: 'sell' }),
    row('a', '2026-10-01T05:00:00Z', 'account_snapshot', { positions: 'p1_5', portfolios: 'one', classes: 'stocks', ledger_age: 'week' }),
    row('a', '2026-10-02T05:00:00Z', 'account_snapshot', { positions: 'p6_20', portfolios: 'one', classes: 'stocks', ledger_age: 'week' }),
  ];
  const c = dailyCohorts(rows, '2026-10-01', '2026-10-03', 3);
  assert.deepEqual(c[0], { day: '2026-10-01', size: 2, retained: [0.5, 0, null] });
  const f = featureAdoption(rows);
  assert.deepEqual(f.map((x) => x.event), ['entry_added']);
  assert.equal(f[0].adoption, 1);
  assert.equal(f[0].repeat, 0.5);
  assert.deepEqual(snapshotMix(rows).positions, [{ key: 'p6_20', n: 1 }]);
});

test('acquisition: sources with activation, audience mix and release adoption', () => {
  const users = [
    { userKey: 'a', firstDay: '2026-09-01', ref: 'whatsapp', src: 'home_hero', origin: 'signup' },
    { userKey: 'b', firstDay: '2026-09-02', ref: 'whatsapp', src: null, origin: 'signup' },
    { userKey: 'c', firstDay: '2026-09-02', ref: null, src: null, origin: 'unknown' },
    { userKey: 'old', firstDay: '2026-09-02', ref: null, src: null, origin: 'existing' },
  ];
  const rows = [
    row('a', '2026-09-01T05:00:00Z', 'entry_added', { kind: 'buy' }, { country: 'PK', os: 'android', browser: 'chrome', formFactor: 'phone', version: 'abc1234' }),
    row('a', '2026-09-10T05:00:00Z', 'app_opened', {}, { country: 'PK', os: 'android', browser: 'chrome', formFactor: 'phone', version: 'abc1234' }),
    row('b', '2026-09-20T05:00:00Z', 'entry_added', { kind: 'buy' }, { country: 'AE', os: 'windows', browser: 'edge', formFactor: 'desktop' }),
  ];
  const s = sources(users, rows, '2026-09-01', '2026-09-30', 'ref');
  assert.deepEqual(s.map((x) => x.key), ['whatsapp', 'direct']);
  assert.equal(s[0].activation, 0.5);
  assert.equal(s[0].retainedW1, 0.5);
  const mix = audienceMix(rows);
  assert.deepEqual(mix.country.map((x) => x.key).sort(), ['AE', 'PK']);
  const v = versionAdoption(rows, '2026-09-01', '2026-09-01');
  assert.equal(v.days[0].byVersion['web abc1234'], 1);
});

test('quality: crash-free visits, error rates, error screens, vitals and timings', () => {
  const rows = [
    screen('a', '2026-10-01T05:00:00Z', 'holdings', { session: 's1' }), row('a', '2026-10-01T05:01:00Z', 'client_error', { area: 'app', code: 'uncaught' }, { session: 's1' }),
    screen('b', '2026-10-01T05:00:00Z', 'reports', { session: 's2' }), row('b', '2026-10-01T05:01:00Z', 'client_error', { area: 'import', code: 'pdf_unrecognized', screen: 'activity' }, { session: 's2' }),
    screen('c', '2026-10-01T05:00:00Z', 'holdings', { session: 's3' }),
    screen('d', '2026-10-01T05:00:00Z', 'holdings', { session: 's4' }),
    ...['good', 'good', 'good', 'poor'].map((rating, i) => row(`v${i}`, '2026-10-01T05:00:00Z', 'web_vital', { metric: 'lcp', rating, bucket: rating === 'good' ? 'under_1s' : 'under_10s', screen: 'holdings' })),
    row('a', '2026-10-01T05:00:00Z', 'timing', { op: 'vault_unlock', bucket: 'under_1s' }), row('b', '2026-10-01T05:00:00Z', 'timing', { op: 'vault_unlock', bucket: 'under_3s' }),
  ];
  const sessions = sessionize(rows.filter((r) => r.event !== 'web_vital' && r.event !== 'timing'));
  const day = qualitySeries(sessions, '2026-10-01', '2026-10-01')[0];
  assert.equal(day.sessions, 4);
  assert.equal(day.crashFree, 0.75);
  assert.equal(day.errorFree, 0.5);
  assert.equal(errorRates(sessions, (s) => s.platform, 1)[0].per1k, 500);
  assert.deepEqual(errorsByScreen(sessions).map((x) => x.key).sort(), ['activity', 'holdings']);
  const lcp = vitals(rows).find((v) => v.metric === 'lcp');
  assert.equal(lcp.good, 0.75);
  assert.equal(lcp.rating, 'good');
  assert.equal(lcp.p75, 'under_1s');
  assert.equal(timings(rows)[0].p50, 'under_1s');
});

test('filters: platform and new versus returning people', () => {
  const rows = [screen('old', '2026-09-01T05:00:00Z', 'holdings'), screen('old', '2026-10-05T05:00:00Z', 'holdings'), screen('new', '2026-10-05T05:00:00Z', 'holdings', { platform: 'android' })];
  const f = (segment, platform = 'all') => filterRows(rows, { from: '2026-10-01', to: '2026-10-07', platform, segment }).map((r) => r.userKey);
  assert.deepEqual(f('new'), ['new']);
  assert.deepEqual(f('returning'), ['old']);
  assert.deepEqual(f('all', 'android'), ['new']);
});

test('summary compares the window with the one before and lists what changed', () => {
  const w = windows({ days: 7, today: '2026-10-14' });
  assert.deepEqual(w, { from: '2026-10-08', to: '2026-10-14', prevFrom: '2026-10-01', prevTo: '2026-10-07' });
  const rows = [screen('a', '2026-10-02T05:00:00Z', 'holdings'), screen('a', '2026-10-09T05:00:00Z', 'holdings'), screen('b', '2026-10-10T05:00:00Z', 'holdings')];
  const users = [{ userKey: 'b', firstDay: '2026-10-10', ref: null, src: null, origin: 'signup' }];
  const r = buildLens(rows, users, { lens: 'summary', days: 7, today: '2026-10-14', platform: 'all', segment: 'all' });
  const active = r.kpis.find((k) => k.id === 'active');
  assert.deepEqual([active.value, active.previous], [2, 1]);
  assert.equal(r.changes.find((c) => c.id === 'active').delta, 100);
  assert.equal(r.changes.find((c) => c.id === 'active').good, true);
  for (const lens of ['journeys', 'engagement', 'acquisition', 'quality'])
    assert.equal(buildLens(rows, users, { lens, days: 7, today: '2026-10-14', platform: 'all', segment: 'all' }).lens, lens);
});

import { createD1 } from './helpers/d1.mjs';
import { insertEvents, noteSignIn, userKey } from '../lib/analytics-store.ts';
import { lensReport } from '../lib/analytics-lens-store.ts';
test('lens report reads the real tables, keys accounts by HMAC and leaves internal people out', async () => {
  const db = createD1();
  const secret = 'test-secret';
  const now = new Date('2026-10-14T08:00:00Z');
  await noteSignIn(db, 'person@example.com', 'web', secret, false, new Date('2026-10-10T08:00:00Z'), { signupRef: 'whatsapp' });
  const key = await userKey('person@example.com', secret);
  await insertEvents(db, { sessionId: 'session-0001', userKey: key, platform: 'web', country: 'PK', device: { os: 'android', browser: 'chrome', formFactor: 'phone' } },
    [{ event: 'screen_viewed', props: { screen: 'holdings' } }, { event: 'entry_added', props: { kind: 'buy' } }], new Date('2026-10-12T08:00:00Z'));
  await insertEvents(db, { sessionId: 'session-0002', userKey: 'f'.repeat(32), platform: 'web', isAdmin: true }, [{ event: 'screen_viewed', props: { screen: 'holdings' } }], new Date('2026-10-12T08:00:00Z'));
  const q = { days: 7, today: '2026-10-14', platform: 'all', segment: 'all' };
  const summary = await lensReport(db, secret, { ...q, lens: 'summary' }, false, [], now);
  assert.equal(summary.kpis.find((k) => k.id === 'active').value, 1);
  const acq = await lensReport(db, secret, { ...q, lens: 'acquisition' }, false, [], now);
  assert.deepEqual(acq.mix.country, [{ key: 'PK', n: 1 }]);
  assert.equal(acq.channels[0].key, 'whatsapp');
  assert.ok(!JSON.stringify(acq).includes('person@example.com'));
  const withAdmin = await lensReport(db, secret, { ...q, lens: 'summary' }, true, [], now);
  assert.equal(withAdmin.kpis.find((k) => k.id === 'active').value, 2);
});
