// Pure calculations behind the super-admin Usage dashboard (no Workers imports, so tests can run them).

export type DayUser = { userKey: string; day: string };
export const DAY_MS = 86_400_000;

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
export const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** The Pakistan (UTC+5) calendar day of an instant. */
export function pktDay(date: Date): string {
  return new Date(date.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
}

export type ActiveCounts = { dau: number; wau: number; mau: number; stickiness: number | null };

/** Distinct active users in the 1, 7 and 30 days ending `today`; stickiness is DAU / MAU. */
export function activeCounts(rows: DayUser[], today: string): ActiveCounts {
  const t = dayNumber(today);
  const within = (span: number) =>
    new Set(rows.filter((r) => { const d = t - dayNumber(r.day); return d >= 0 && d < span; }).map((r) => r.userKey)).size;
  const dau = within(1), wau = within(7), mau = within(30);
  return { dau, wau, mau, stickiness: mau ? dau / mau : null };
}

/** Distinct active users per day for the `days` days ending `today`, oldest first (zero-filled). */
export function dailyActive(rows: DayUser[], today: string, days: number): { day: string; users: number }[] {
  const t = dayNumber(today);
  const byDay = new Map<string, Set<string>>();
  for (const r of rows) (byDay.get(r.day) ?? byDay.set(r.day, new Set()).get(r.day)!).add(r.userKey);
  return Array.from({ length: days }, (_, i) => {
    const day = dayString(t - (days - 1 - i));
    return { day, users: byDay.get(day)?.size ?? 0 };
  });
}

export type CohortRow = { week: string; size: number; retained: (number | null)[] };

/** Monday of the week containing `day`. */
export function weekStart(day: string): string {
  const n = dayNumber(day);
  return dayString(n - ((n + 3) % 7));
}

/**
 * Weekly sign-up cohorts: for each cohort the share (0..1) of its users active in week +0..+`weeks`, null for weeks
 * that have not happened yet.
 */
export function retentionCohorts(signups: DayUser[], activity: DayUser[], today: string, weeks = 8): CohortRow[] {
  const activeWeeks = new Map<string, Set<string>>();
  for (const a of activity) {
    const w = weekStart(a.day);
    (activeWeeks.get(a.userKey) ?? activeWeeks.set(a.userKey, new Set()).get(a.userKey)!).add(w);
  }
  const cohorts = new Map<string, string[]>();
  for (const s of signups) {
    const w = weekStart(s.day);
    (cohorts.get(w) ?? cohorts.set(w, []).get(w)!).push(s.userKey);
  }
  const thisWeek = dayNumber(weekStart(today));
  return [...cohorts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, users]) => {
      const start = dayNumber(week);
      const retained = Array.from({ length: weeks + 1 }, (_, offset) => {
        const target = start + offset * 7;
        if (target > thisWeek) return null;
        const label = dayString(target);
        return users.filter((u) => activeWeeks.get(u)?.has(label)).length / users.length;
      });
      return { week, size: users.length, retained };
    });
}

/** Users who signed up and were active again on a later day within 7 days. */
export function returnedWithinWeek(signups: DayUser[], activity: DayUser[]): number {
  const days = new Map<string, number[]>();
  for (const a of activity) (days.get(a.userKey) ?? days.set(a.userKey, []).get(a.userKey)!).push(dayNumber(a.day));
  let n = 0;
  for (const s of signups) {
    const start = dayNumber(s.day);
    if (days.get(s.userKey)?.some((d) => d > start && d <= start + 7)) n++;
  }
  return n;
}
