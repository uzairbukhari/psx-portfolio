import assert from 'node:assert/strict';
import test from 'node:test';
import { rateDecision } from '../lib/rate-limit.ts';

const now = new Date('2026-09-30T06:00:00Z');
const opts = { windowMs: 5 * 60_000, max: 1 };

test('first use in a window is allowed and starts the window', () => {
  const d = rateDecision(null, now, opts);
  assert.equal(d.allowed, true);
  assert.deepEqual(d.next, { windowStart: now.toISOString(), count: 1 });
});

test('a second use inside the window is refused with the wait time', () => {
  const d = rateDecision({ windowStart: '2026-09-30T05:58:00Z', count: 1 }, now, opts);
  assert.equal(d.allowed, false);
  assert.equal(d.retryAfterMs, 3 * 60_000);
});

test('use after the window expires resets the count', () => {
  const d = rateDecision({ windowStart: '2026-09-30T05:54:00Z', count: 1 }, now, opts);
  assert.equal(d.allowed, true);
  assert.deepEqual(d.next, { windowStart: now.toISOString(), count: 1 });
});

test('counts up to max within a window', () => {
  const daily = { windowMs: 86_400_000, max: 3 };
  const row = { windowStart: '2026-09-30T01:00:00Z', count: 2 };
  const d = rateDecision(row, now, daily);
  assert.equal(d.allowed, true);
  assert.deepEqual(d.next, { windowStart: row.windowStart, count: 3 });
  assert.equal(rateDecision(d.next, now, daily).allowed, false);
});

test('an unreadable window start is treated as expired', () => {
  assert.equal(rateDecision({ windowStart: 'garbage', count: 9 }, now, opts).allowed, true);
});
