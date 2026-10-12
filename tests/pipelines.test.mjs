import test from 'node:test';
import assert from 'node:assert/strict';
import { PIPELINES, pipelineStatus, weekdayAdjustedHours, worst } from '../lib/pipelines.ts';

const def = (id) => PIPELINES.find((p) => p.id === id);
const iso = (s) => new Date(s).toISOString();

test('weekday-adjusted hours skip Saturday and Sunday in Pakistan time', () => {
  // Friday 17:00 PKT to Monday 09:00 PKT is 24 weekday hours counted, not 64.
  assert.equal(weekdayAdjustedHours(new Date('2026-10-09T12:00:00Z'), new Date('2026-10-12T04:00:00Z')), 7 + 9);
  // Tuesday to Wednesday is the plain difference.
  assert.equal(weekdayAdjustedHours(new Date('2026-10-13T06:00:00Z'), new Date('2026-10-14T06:00:00Z')), 24);
  // A window that sits entirely on a weekend counts nothing.
  assert.equal(weekdayAdjustedHours(new Date('2026-10-10T06:00:00Z'), new Date('2026-10-11T06:00:00Z')), 0);
});

test('quotes are judged in minutes while the market is open', () => {
  const now = new Date('2026-10-12T07:00:00Z'); // Monday, open
  assert.equal(pipelineStatus(def('quotes'), iso('2026-10-12T06:50:00Z'), null, now, true).status, 'ok');
  assert.equal(pipelineStatus(def('quotes'), iso('2026-10-12T06:00:00Z'), null, now, true).status, 'late');
  assert.equal(pipelineStatus(def('quotes'), iso('2026-10-12T04:00:00Z'), null, now, true).status, 'failing');
});

test('quotes are not flagged overnight or at the weekend when the last session was fetched', () => {
  const sunday = new Date('2026-10-11T10:00:00Z');
  assert.equal(pipelineStatus(def('quotes'), iso('2026-10-09T11:40:00Z'), null, sunday, false).status, 'ok');
  const wednesday = new Date('2026-10-15T10:00:00Z'); // Thursday: four weekdays without a quote
  assert.equal(pipelineStatus(def('quotes'), iso('2026-10-09T11:40:00Z'), null, wednesday, false).status, 'failing');
});

test('daily pipelines are late after 36 weekday hours and failing after 84', () => {
  const now = new Date('2026-10-14T12:00:00Z'); // Wednesday
  assert.equal(pipelineStatus(def('facts'), iso('2026-10-13T12:00:00Z'), null, now, false).status, 'ok');
  assert.equal(pipelineStatus(def('facts'), iso('2026-10-12T12:00:00Z'), null, now, false).status, 'late');
  assert.equal(pipelineStatus(def('facts'), iso('2026-10-08T12:00:00Z'), null, now, false).status, 'failing');
  // Monday morning after a Friday run is still fine.
  assert.equal(pipelineStatus(def('facts'), iso('2026-10-09T12:00:00Z'), null, new Date('2026-10-12T05:00:00Z'), false).status, 'ok');
});

test('a pipeline that never ran is failing when required and idle when optional', () => {
  const now = new Date('2026-10-12T07:00:00Z');
  assert.equal(pipelineStatus(def('quotes'), null, null, now, true).status, 'failing');
  assert.equal(pipelineStatus(def('ai-research'), null, null, now, true).status, 'idle');
});

test('an error newer than the last success keeps an otherwise fresh row from reading ok', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  const fresh = iso('2026-10-14T06:00:00Z');
  assert.equal(pipelineStatus(def('funds'), fresh, { at: iso('2026-10-14T09:00:00Z') }, now, false).status, 'late');
  assert.equal(pipelineStatus(def('funds'), fresh, { at: iso('2026-10-14T03:00:00Z') }, now, false).status, 'ok');
});

test('worst picks the more serious status', () => {
  assert.equal(worst('ok', 'late'), 'late');
  assert.equal(worst('failing', 'late'), 'failing');
  assert.equal(worst('idle', 'ok'), 'idle');
});
