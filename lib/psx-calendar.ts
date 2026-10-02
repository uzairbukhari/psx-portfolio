/**
 * PSX trading calendar: weekends plus market holidays, used for dividend
 * entitlement dates and "latest session" checks.
 *
 * Source for the 2026 list: https://www.psx.com.pk/psx/exchange/general/calendar-holidays
 * (Islamic dates are "subject to appearance of moon"; the exchange reserves the
 * right to change them). Lunar holidays move every year, so they are listed per
 * year; only fixed-date national holidays are assumed for other years. Add a
 * year to `LUNAR_HOLIDAYS` (and `COMPLETE_YEARS`) once PSX publishes it.
 */
const FIXED_HOLIDAYS = ['02-05', '03-23', '05-01', '05-28', '08-14', '11-09', '12-25'];

const LUNAR_HOLIDAYS: Record<number, string[]> = {
  2026: [
    '2026-03-20', // Juma-tul-Wida
    '2026-03-21', '2026-03-22', '2026-03-23', // Eid-ul-Fitr
    '2026-05-26', '2026-05-27', '2026-05-28', // Eid-ul-Azha
    '2026-06-25', '2026-06-26', // Ashura
    '2026-08-25', // Eid Milad-un-Nabi
  ],
};

/** Years whose complete holiday list is known. Outside them, dates derived from the calendar are estimates. */
const COMPLETE_YEARS = new Set(Object.keys(LUNAR_HOLIDAYS).map(Number));

/** PSX moved equity settlement from T+2 to T+1 for trades from this date. */
export const SETTLEMENT_T1_FROM = '2026-02-09';

const lunar = new Set(Object.values(LUNAR_HOLIDAYS).flat());
const DAY_MS = 86_400_000;
const parse = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (date: string, days: number) => iso(new Date(parse(date).getTime() + days * DAY_MS));

export function isTradingDay(date: string): boolean {
  const weekday = parse(date).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !FIXED_HOLIDAYS.includes(date.slice(5)) && !lunar.has(date);
}

/** True when the full holiday list for this date's year is known. */
export const calendarCovers = (date: string) => COMPLETE_YEARS.has(Number(date.slice(0, 4)));

/** `date` itself when it is a trading day, otherwise the closest earlier one. */
export function lastTradingDay(date: string): string {
  let d = date;
  while (!isTradingDay(d)) d = shift(d, -1);
  return d;
}

/** The trading day `n` sessions before `date` (n = 0 returns `date` unchanged). */
export function subtractTradingDays(date: string, n: number): string {
  let d = date;
  for (let left = n; left > 0; ) {
    d = shift(d, -1);
    if (isTradingDay(d)) left--;
  }
  return d;
}

export type Entitlement = {
  /** Last trade date that still qualifies for the dividend. */
  date: string;
  settlement: 'T+1' | 'T+2';
  /** False when the calendar for that year is incomplete, so the date is only an estimate. */
  certain: boolean;
};

/**
 * Last qualifying trade date for a dividend whose book closure starts on `bookClosureStart`:
 * a trade must settle by then, so it is one (T+1) or two (T+2) trading days earlier. The
 * settlement rule is the one in force on the trade date.
 */
export function dividendEntitlement(bookClosureStart: string): Entitlement {
  const t1 = subtractTradingDays(bookClosureStart, 1);
  const useT1 = t1 >= SETTLEMENT_T1_FROM;
  return {
    date: useT1 ? t1 : subtractTradingDays(bookClosureStart, 2),
    settlement: useT1 ? 'T+1' : 'T+2',
    certain: calendarCovers(bookClosureStart) && calendarCovers(t1),
  };
}

const PKT_OFFSET_MS = 5 * 3_600_000;
/** Minutes after midnight PKT when the regular session closes, plus PSX's few minutes to publish closing prices. */
const closeMinutes = (weekday: number) => (weekday === 5 ? 16 * 60 + 30 : 15 * 60 + 30) + 10;

/**
 * PKT date of the most recent regular session that has finished at `now`: today once the close has
 * printed on a trading day, otherwise the previous trading day. Weekends and holidays are skipped.
 */
export function latestCompletedSessionDate(now: Date): string {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const date = iso(pkt);
  const minutes = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
  if (isTradingDay(date) && minutes >= closeMinutes(pkt.getUTCDay())) return date;
  return lastTradingDay(shift(date, -1));
}
