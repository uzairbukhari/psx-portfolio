import test from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, groupTimeline, segmentsOf, stageOf } from '../lib/user-lifecycle.ts';

const base = {
  firstSeenDay: '2026-10-01', lastActiveDay: '2026-10-10', origin: 'signup', vaultCreated: false, vaultExists: false, content: false,
  targets: false, picks: false, activeDays30: 1, errors7: 0, sipDays: 0, lastSipDay: null, hasUsage: true,
};

test('stage is the furthest step reached', () => {
  assert.equal(stageOf(base), 'signed_up');
  assert.equal(stageOf({ ...base, vaultCreated: true }), 'vault');
  assert.equal(stageOf({ ...base, vaultExists: true }), 'vault');
  assert.equal(stageOf({ ...base, origin: 'existing' }), 'vault');
  assert.equal(stageOf({ ...base, vaultCreated: true, content: true }), 'content');
  assert.equal(stageOf({ ...base, content: true, targets: true }), 'sip_targets');
  assert.equal(stageOf({ ...base, content: true, targets: true, picks: true }), 'picks');
  assert.equal(stageOf({ ...base, content: true, targets: true, picks: true, activeDays30: 3 }), 'habit');
});

test('day maths uses calendar days', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-15'), 14);
  assert.equal(daysBetween('2026-02-27', '2026-03-01'), 2);
});

test('segments follow their thresholds', () => {
  const today = '2026-10-15';
  assert.deepEqual(segmentsOf({ ...base, firstSeenDay: '2026-10-14', lastActiveDay: '2026-10-14' }, today), []);
  assert.ok(segmentsOf({ ...base, firstSeenDay: '2026-10-13', lastActiveDay: '2026-10-14' }, today).includes('no_vault'));
  assert.ok(segmentsOf({ ...base, vaultCreated: true, lastActiveDay: '2026-10-14' }, today).includes('vault_no_content'));
  assert.ok(!segmentsOf({ ...base, vaultCreated: true, content: true, lastActiveDay: '2026-10-14' }, today).includes('vault_no_content'));
  assert.ok(segmentsOf({ ...base, lastActiveDay: '2026-10-01' }, today).includes('inactive_14d'));
  assert.ok(!segmentsOf({ ...base, lastActiveDay: '2026-10-02' }, today).includes('inactive_14d'));
  const sip = { ...base, lastActiveDay: '2026-10-14', sipDays: 1, lastSipDay: '2026-09-15' };
  assert.ok(segmentsOf(sip, today).includes('sip_once'));
  assert.ok(!segmentsOf({ ...sip, lastSipDay: '2026-09-16' }, today).includes('sip_once'));
  assert.ok(!segmentsOf({ ...sip, sipDays: 2 }, today).includes('sip_once'));
  assert.ok(segmentsOf({ ...base, lastActiveDay: '2026-10-14', errors7: 3 }, today).includes('erroring'));
  assert.ok(segmentsOf({ ...base, lastActiveDay: '2026-10-14', hasUsage: false }, today).includes('no_events'));
});

const ev = (ts, sessionId, event, props = null) => ({ ts, sessionId, platform: 'web', appVersion: null, event, props: props && JSON.stringify(props) });

test('timeline groups sessions newest first and collapses screen runs', () => {
  const sessions = groupTimeline([
    ev('2026-10-01T10:00:00Z', 's1', 'app_opened'),
    ev('2026-10-01T10:00:05Z', 's1', 'screen_viewed', { screen: 'holdings' }),
    ev('2026-10-01T10:00:10Z', 's1', 'screen_viewed', { screen: 'reports' }),
    ev('2026-10-01T10:00:20Z', 's1', 'entry_added', { kind: 'buy' }),
    ev('2026-10-01T10:00:30Z', 's1', 'screen_viewed', { screen: 'sip' }),
    ev('2026-10-02T09:00:00Z', 's2', 'app_opened'),
  ]);
  assert.deepEqual(sessions.map((s) => s.id), ['s2', 's1']);
  assert.deepEqual(sessions[1].items.map((i) => i.label), ['App opened', 'Holdings › Insights', 'Entry added (buy)', 'Monthly Picks']);
  assert.equal(sessions[1].end, '2026-10-01T10:00:30Z');
});
