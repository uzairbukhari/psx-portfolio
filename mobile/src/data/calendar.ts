// Pure date helpers for the in-app date picker (no native date module): a month grid plus ISO-date maths.
// Dates are plain 'YYYY-MM-DD' strings throughout, the format the ledger stores.

const DAY_MS = 86_400_000;
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function addDays(date: string, days: number): string {
  return iso(new Date(parse(date).getTime() + days * DAY_MS));
}

/** Moves a { year, month (1-12) } pair by whole months. */
export function shiftYearMonth(ym: { year: number; month: number }, delta: number) {
  const index = ym.year * 12 + (ym.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export const monthTitle = (ym: { year: number; month: number }) => `${MONTH_NAMES[ym.month - 1]} ${ym.year}`;

/** Weeks (Monday first) of a month; days outside the month are null. Every row has seven cells. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(iso(new Date(Date.UTC(year, month - 1, d))));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Spoken form of a date, for screen readers: "Friday 2 October 2026". */
export function spokenDate(date: string): string {
  const d = parse(date);
  const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  return `${weekday} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Clamps a date into [min, max] (either optional). */
export function clampDate(date: string, min?: string, max?: string): string {
  if (max && date > max) return max;
  if (min && date < min) return min;
  return date;
}

const MONTH_VALUE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** True for a 'YYYY-MM' SIP month. */
export const isMonthValue = (value: string) => MONTH_VALUE.test(value);

/** 'YYYY-MM' to { year, month (1-12) }, or null when it is not a valid month. */
export function parseMonthValue(value: string): { year: number; month: number } | null {
  const m = MONTH_VALUE.exec(value);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** { year, month (1-12) } to the 'YYYY-MM' string the ledger stores. */
export const monthValue = (ym: { year: number; month: number }) => `${String(ym.year).padStart(4, '0')}-${String(ym.month).padStart(2, '0')}`;
