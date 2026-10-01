import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, clampDate, monthGrid, monthTitle, shiftYearMonth, spokenDate } from './calendar.ts';

test('monthGrid starts on Monday, pads to full weeks and holds every day once', () => {
  const weeks = monthGrid(2026, 10); // 1 Oct 2026 is a Thursday
  assert.ok(weeks.every((w) => w.length === 7));
  assert.deepEqual(weeks[0].slice(0, 3), [null, null, null]);
  assert.equal(weeks[0][3], '2026-10-01');
  const days = weeks.flat().filter(Boolean);
  assert.equal(days.length, 31);
  assert.equal(days.at(-1), '2026-10-31');
});

test('monthGrid handles February in a leap year and a month starting on Monday', () => {
  assert.equal(monthGrid(2028, 2).flat().filter(Boolean).length, 29);
  assert.equal(monthGrid(2026, 6)[0][0], '2026-06-01');
});

test('addDays and shiftYearMonth cross month and year boundaries', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(shiftYearMonth({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftYearMonth({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.equal(monthTitle({ year: 2026, month: 10 }), 'October 2026');
});

test('spokenDate names the weekday and clampDate bounds a date', () => {
  assert.equal(spokenDate('2026-10-02'), 'Friday 2 October 2026');
  assert.equal(clampDate('2026-10-05', undefined, '2026-10-02'), '2026-10-02');
  assert.equal(clampDate('2026-09-01', '2026-09-15'), '2026-09-15');
  assert.equal(clampDate('2026-09-20', '2026-09-15', '2026-10-01'), '2026-09-20');
});
