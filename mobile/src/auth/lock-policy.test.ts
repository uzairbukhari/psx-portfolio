import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCK_GRACE_MS, shouldLock } from './lock-policy.ts';

test('does not lock when the app was never backgrounded', () => {
  assert.equal(shouldLock(null, 1_000_000), false);
});

test('locks only after the grace period away', () => {
  assert.equal(shouldLock(1_000, 1_000 + LOCK_GRACE_MS - 1), false);
  assert.equal(shouldLock(1_000, 1_000 + LOCK_GRACE_MS), true);
});
