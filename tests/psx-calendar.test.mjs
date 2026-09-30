import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calendarCovers,
  isTradingDay,
  lastTradingDay,
  subtractTradingDays,
  dividendEntitlement,
  SETTLEMENT_T1_FROM,
} from '../lib/psx-calendar.ts';

test('weekends are not trading days', () => {
  assert.equal(isTradingDay('2026-09-26'), false); // Saturday
  assert.equal(isTradingDay('2026-09-27'), false); // Sunday
  assert.equal(isTradingDay('2026-09-28'), true);
});

test('2026 PSX holidays from the published calendar are not trading days', () => {
  for (const d of ['2026-02-05', '2026-03-20', '2026-03-23', '2026-05-01', '2026-05-26', '2026-05-27', '2026-05-28', '2026-06-25', '2026-06-26', '2026-08-14', '2026-08-25', '2026-11-09', '2026-12-25'])
    assert.equal(isTradingDay(d), false, d);
  assert.equal(isTradingDay('2026-02-06'), true);
  assert.equal(isTradingDay('2026-06-24'), true);
});

test('fixed-date national holidays apply in every year', () => {
  assert.equal(isTradingDay('2027-08-14'), false); // Saturday anyway; check a weekday one
  assert.equal(isTradingDay('2028-08-14'), false); // Monday
  assert.equal(isTradingDay('2025-03-24'), true);
});

test('calendarCovers is true only for years whose full holiday list is known', () => {
  assert.equal(calendarCovers('2026-09-01'), true);
  assert.equal(calendarCovers('2025-09-01'), false);
  assert.equal(calendarCovers('2027-01-04'), false);
});

test('lastTradingDay returns the date itself on a trading day, else the previous one', () => {
  assert.equal(lastTradingDay('2026-09-28'), '2026-09-28');
  assert.equal(lastTradingDay('2026-09-27'), '2026-09-25'); // Sunday -> Friday
  assert.equal(lastTradingDay('2026-06-28'), '2026-06-24'); // Sun after Ashura Thu/Fri
  assert.equal(lastTradingDay('2026-03-24'), '2026-03-24'); // Tuesday after Eid + Pakistan Day
});

test('subtractTradingDays skips weekends and holidays', () => {
  assert.equal(subtractTradingDays('2026-09-28', 1), '2026-09-25');
  assert.equal(subtractTradingDays('2026-09-28', 2), '2026-09-24');
  assert.equal(subtractTradingDays('2026-06-29', 1), '2026-06-24'); // over Ashura + weekend
  assert.equal(subtractTradingDays('2026-09-28', 0), '2026-09-28');
});

test('T+1 settlement is effective from 9 February 2026', () => {
  assert.equal(SETTLEMENT_T1_FROM, '2026-02-09');
});

test('entitlement under T+1 is one trading day before book closure start', () => {
  const e = dividendEntitlement('2026-09-30');
  assert.equal(e.date, '2026-09-29');
  assert.equal(e.settlement, 'T+1');
  assert.equal(e.certain, true);
});

test('entitlement skips a holiday before book closure', () => {
  // Book closure Tue 2026-08-18: Mon 17th is a trading day.
  assert.equal(dividendEntitlement('2026-08-18').date, '2026-08-17');
  // Book closure Mon 2026-08-17 -> Fri 14th is a holiday, Thu 13th.
  assert.equal(dividendEntitlement('2026-08-17').date, '2026-08-13');
});

test('entitlement before the T+1 switch uses T+2', () => {
  const e = dividendEntitlement('2026-01-14'); // Wednesday
  assert.equal(e.settlement, 'T+2');
  assert.equal(e.date, '2026-01-12');
});

test('the settlement switch is decided by the last qualifying trade date', () => {
  // Book closure Tue 2026-02-10: T+1 -> Mon 9th, which is on/after the switch.
  assert.equal(dividendEntitlement('2026-02-10').date, '2026-02-09');
  assert.equal(dividendEntitlement('2026-02-10').settlement, 'T+1');
  // Book closure Mon 2026-02-09: T+1 -> Fri 6th is before the switch, so T+2 -> Thu 5th is a holiday -> Wed 4th.
  const e = dividendEntitlement('2026-02-09');
  assert.equal(e.settlement, 'T+2');
  assert.equal(e.date, '2026-02-04');
});

test('entitlement outside a fully known calendar year is flagged uncertain', () => {
  assert.equal(dividendEntitlement('2025-08-20').certain, false);
  assert.equal(dividendEntitlement('2026-08-20').certain, true);
});
