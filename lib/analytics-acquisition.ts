// Acquisition: where people came from (the social channel and the marketing button stored on app_users at sign-up),
// how many of each became active and stayed, and what they use (country, device, browser, release). Pure module.
import { weekStart } from './analytics-report.ts';
import { bump, dayNum, daysBetween, numDay, ranked, share, type EventRow } from './analytics-rows.ts';

/** One account as acquisition sees it: the HMAC user key (never the email), first-seen day and sign-up attribution. */
export type AcquiredUser = { userKey: string; firstDay: string; ref: string | null; src: string | null; origin: string };

export type SourceRow = { key: string; signups: number; activated: number; activation: number | null; retainedW1: number | null };

const ACTIVATING = new Set(['entry_added', 'import_completed', 'asset_added']);

/**
 * Sign-ups per channel (or per marketing button) in the window, with activation (added something within 7 days of
 * signing up) and week-1 retention (active again 7 to 13 days after signing up).
 */
export function sources(users: AcquiredUser[], rows: EventRow[], from: string, to: string, by: 'ref' | 'src'): SourceRow[] {
  const days = new Map<string, Set<number>>();
  const activatedAt = new Map<string, number>();
  for (const r of rows) {
    const n = dayNum(r.day);
    (days.get(r.userKey) ?? days.set(r.userKey, new Set()).get(r.userKey)!).add(n);
    if (ACTIVATING.has(r.event) && (!activatedAt.has(r.userKey) || activatedAt.get(r.userKey)! > n)) activatedAt.set(r.userKey, n);
  }
  const groups = new Map<string, { signups: number; activated: number; w1: number; w1Eligible: number }>();
  const lastDay = dayNum(to);
  for (const u of users) {
    if (u.origin === 'existing' || u.firstDay < from || u.firstDay > to) continue;
    const key = (by === 'ref' ? u.ref : u.src) ?? 'direct';
    const g = groups.get(key) ?? groups.set(key, { signups: 0, activated: 0, w1: 0, w1Eligible: 0 }).get(key)!;
    const start = dayNum(u.firstDay);
    g.signups += 1;
    const act = activatedAt.get(u.userKey);
    if (act !== undefined && act - start <= 7) g.activated += 1;
    if (start + 13 <= lastDay) {
      g.w1Eligible += 1;
      if ([...(days.get(u.userKey) ?? [])].some((d) => d - start >= 7 && d - start <= 13)) g.w1 += 1;
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, signups: g.signups, activated: g.activated, activation: share(g.activated, g.signups), retainedW1: share(g.w1, g.w1Eligible) }))
    .sort((a, b) => b.signups - a.signups);
}

/** Sign-ups per week and channel, for the stacked chart. */
export function signupsByWeek(users: AcquiredUser[], from: string, to: string): { week: string; byRef: Record<string, number> }[] {
  const weeks = new Map<string, Record<string, number>>();
  for (let n = dayNum(weekStart(from)); n <= dayNum(to); n += 7) weeks.set(numDay(n), {});
  for (const u of users) {
    if (u.origin === 'existing' || u.firstDay < from || u.firstDay > to) continue;
    const w = weekStart(u.firstDay);
    const row = weeks.get(w) ?? weeks.set(w, {}).get(w)!;
    const k = u.ref ?? 'direct';
    row[k] = (row[k] ?? 0) + 1;
  }
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, byRef]) => ({ week, byRef }));
}

export type Mix = { country: { key: string; n: number }[]; os: { key: string; n: number }[]; browser: { key: string; n: number }[]; formFactor: { key: string; n: number }[]; platform: { key: string; n: number }[] };

/** People per country, OS, browser, form factor and platform, each person counted once at their latest event. */
export function audienceMix(rows: EventRow[]): Mix {
  const latest = new Map<string, EventRow>();
  const latestWith = new Map<string, EventRow>();
  for (const r of rows) {
    if (!latest.has(r.userKey) || latest.get(r.userKey)!.ts < r.ts) latest.set(r.userKey, r);
    if (r.os && (!latestWith.has(r.userKey) || latestWith.get(r.userKey)!.ts < r.ts)) latestWith.set(r.userKey, r);
  }
  const c = { country: new Map<string, number>(), os: new Map<string, number>(), browser: new Map<string, number>(), formFactor: new Map<string, number>(), platform: new Map<string, number>() };
  for (const [u, r] of latest) {
    const d = latestWith.get(u);
    bump(c.platform, r.platform);
    bump(c.country, d?.country ?? 'unknown');
    bump(c.os, d?.os ?? 'unknown');
    bump(c.browser, d?.browser ?? 'unknown');
    bump(c.formFactor, d?.formFactor ?? 'unknown');
  }
  return { country: ranked(c.country, 10), os: ranked(c.os, 8), browser: ranked(c.browser, 8), formFactor: ranked(c.formFactor, 4), platform: ranked(c.platform, 4) };
}

/** People per day on each release (platform + version), the top `top` releases and "other". */
export function versionAdoption(rows: EventRow[], from: string, to: string, top = 5): { versions: string[]; days: { day: string; byVersion: Record<string, number> }[] } {
  const total = new Map<string, Set<string>>();
  const byDay = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    const v = `${r.platform} ${r.appVersion ?? 'unknown'}`;
    (total.get(v) ?? total.set(v, new Set()).get(v)!).add(r.userKey);
    const d = byDay.get(r.day) ?? byDay.set(r.day, new Map()).get(r.day)!;
    (d.get(v) ?? d.set(v, new Set()).get(v)!).add(r.userKey);
  }
  const versions = [...total.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, top).map(([v]) => v);
  const keep = new Set(versions);
  const hasOther = total.size > versions.length;
  return {
    versions: hasOther ? [...versions, 'other'] : versions,
    days: daysBetween(from, to).map((day) => {
      const byVersion: Record<string, number> = Object.fromEntries((hasOther ? [...versions, 'other'] : versions).map((v) => [v, 0]));
      const other = new Set<string>();
      for (const [v, users] of byDay.get(day) ?? []) {
        if (keep.has(v)) byVersion[v] = users.size;
        else for (const u of users) other.add(u);
      }
      if (hasOther) byVersion.other = other.size;
      return { day, byVersion };
    }),
  };
}
