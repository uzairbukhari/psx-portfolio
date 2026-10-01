import test from 'node:test';
import assert from 'node:assert/strict';
import { marketOpen, shouldPollMarket } from './market-hours.ts';

// PKT is UTC+5. Thursday 1 Oct 2026.
const thursdayMidday = new Date('2026-10-01T07:00:00Z'); // 12:00 PKT
const thursdayNight = new Date('2026-10-01T18:00:00Z'); // 23:00 PKT
const saturday = new Date('2026-10-03T07:00:00Z');

test('market is open on a weekday session and closed at night and at weekends', () => {
  assert.equal(marketOpen(thursdayMidday), true);
  assert.equal(marketOpen(thursdayNight), false);
  assert.equal(marketOpen(saturday), false);
});

test('polling needs both focus and an open market', () => {
  assert.equal(shouldPollMarket(true, thursdayMidday), true);
  assert.equal(shouldPollMarket(false, thursdayMidday), false);
  assert.equal(shouldPollMarket(true, thursdayNight), false);
});
