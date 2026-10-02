import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyObservation, latestCompletedSession, dataMeta } from '../lib/market-freshness.ts';

const at = (iso) => new Date(iso);

test('open session: a recently quoted value is fresh, an old one is stale', () => {
  const now = at('2026-09-21T06:00:00Z'); // Monday 11:00 PKT
  assert.equal(classifyObservation({ sourceTimestamp: '2026-09-21T05:55:00Z', now }).freshness, 'fresh');
  assert.equal(classifyObservation({ sourceTimestamp: '2026-09-21T05:30:00Z', now }).freshness, 'stale');
});

test('open session: a recent fetch without a source time is only "delayed", never fresh', () => {
  const now = at('2026-09-21T06:00:00Z');
  const result = classifyObservation({ fetchedAt: '2026-09-21T05:58:00Z', now });
  assert.equal(result.freshness, 'delayed');
  assert.match(result.reason, /does not say when/);
  assert.equal(result.sessionInferred, true);
});

test('open session: yesterday\'s value is stale however recently it was fetched', () => {
  const now = at('2026-09-22T06:00:00Z');
  const result = classifyObservation({ sessionDate: '2026-09-21', fetchedAt: '2026-09-22T05:59:00Z', now });
  assert.equal(result.freshness, 'stale');
});

test('closed: Monday morning before the open, Friday-session data is the latest completed session', () => {
  const now = at('2026-09-21T02:00:00Z'); // Monday 07:00 PKT, market closed
  assert.equal(latestCompletedSession(now), '2026-09-18');
  assert.equal(classifyObservation({ sessionDate: '2026-09-18', fetchedAt: '2026-09-18T11:50:00Z', now }).freshness, 'fresh');
  assert.equal(classifyObservation({ sessionDate: '2026-09-17', fetchedAt: '2026-09-18T11:50:00Z', now }).freshness, 'stale');
});

test('closed: a recent fetch of an old session is stale (fetch time is not evidence)', () => {
  const now = at('2026-09-21T02:00:00Z');
  const result = classifyObservation({ sessionDate: '2026-09-16', fetchedAt: '2026-09-21T01:59:00Z', now });
  assert.equal(result.freshness, 'stale');
});

test('holiday Monday: Friday remains the latest completed session', () => {
  const now = at('2026-03-23T06:00:00Z'); // Pakistan Day, a Monday
  // 20 March 2026 (Juma-tul-Wida) and the Eid days that follow are holidays too, so Thursday 19th was the last session.
  assert.equal(latestCompletedSession(now), '2026-03-19');
  assert.equal(classifyObservation({ sessionDate: '2026-03-19', now }).freshness, 'fresh');
  assert.equal(classifyObservation({ sessionDate: '2026-03-18', now }).freshness, 'stale');
});

test('Friday break is closed for freshness: the morning session is the latest completed evidence', () => {
  const now = at('2026-09-25T08:00:00Z'); // Friday 13:00 PKT, in the break
  const result = classifyObservation({ sourceTimestamp: '2026-09-25T06:55:00Z', now });
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.session, '2026-09-25');
});

test('year boundary: a 31 Dec value is judged against the right session on 2 Jan', () => {
  const now = at('2027-01-04T02:00:00Z'); // Monday 4 Jan 2027, pre-open
  assert.equal(latestCompletedSession(now), '2027-01-01');
  assert.equal(classifyObservation({ sessionDate: '2026-12-25', now }).freshness, 'stale');
});

test('no observation at all is unavailable', () => {
  assert.equal(classifyObservation({ now: at('2026-09-21T06:00:00Z') }).freshness, 'unavailable');
});

test('dataMeta keeps source and fetch time separate and does not freshen on failure', () => {
  const meta = dataMeta({
    provider: 'PSX', sourceUrl: 'https://dps.psx.com.pk/', sourceTimestamp: '2026-09-21T05:00:00Z', fetchedAt: '2026-09-21T05:01:00Z',
    lastSuccessAt: '2026-09-21T05:01:00Z', lastFailure: { at: '2026-09-21T05:59:00Z', message: '520' }, now: at('2026-09-21T06:00:00Z'),
  });
  assert.equal(meta.freshness, 'stale', 'a failed refresh does not make 1-hour-old data fresh');
  assert.equal(meta.sourceTimestamp, '2026-09-21T05:00:00Z');
  assert.equal(meta.fetchedAt, '2026-09-21T05:01:00Z');
  assert.equal(meta.lastFailure.message, '520');
});
