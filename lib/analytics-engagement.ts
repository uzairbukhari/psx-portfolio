// Engagement: active users and stickiness over time, how many days a month people come back, weekly lifecycle (new,
// returning, resurrected, churned), daily cohorts, feature adoption and the account-size mix. Pure module.
import { weekStart } from './analytics-report.ts';
import { bump, dayNum, daysBetween, firstSeen, numDay, PASSIVE, share, type EventRow } from './analytics-rows.ts';

export type ActivePoint = { day: string; dau: number; wau: number; mau: number; stickiness: number | null };

/**
 * DAU, rolling 7-day WAU and rolling 28-day MAU for each day from `from` to `to`. `rows` should include the 27 days
 * before `from` so the first points are complete.
 */
export function activeSeries(rows: EventRow[], from: string, to: string): ActivePoint[] {
  const usersByDay = new Map<number, Set<string>>();
  for (const r of rows) {
    const n = dayNum(r.day);
    (usersByDay.get(n) ?? usersByDay.set(n, new Set()).get(n)!).add(r.userKey);
  }
  const within = (end: number, span: number) => {
    const s = new Set<string>();
    for (let n = end - span + 1; n <= end; n++) for (const u of usersByDay.get(n) ?? []) s.add(u);
    return s.size;
  };
  return daysBetween(from, to).map((day) => {
    const n = dayNum(day);
    const dau = usersByDay.get(n)?.size ?? 0;
    const mau = within(n, 28);
    return { day, dau, wau: within(n, 7), mau, stickiness: share(dau, mau) };
  });
}

/** How many of the last 28 days (ending `to`) each active person was active: index 0 = 1 day ... 27 = 28 days. */
export function powerCurve(rows: EventRow[], to: string): number[] {
  const end = dayNum(to);
  const days = new Map<string, Set<number>>();
  for (const r of rows) {
    const n = dayNum(r.day);
    if (n > end - 28 && n <= end) (days.get(r.userKey) ?? days.set(r.userKey, new Set()).get(r.userKey)!).add(n);
  }
  const curve = Array.from({ length: 28 }, () => 0);
  for (const set of days.values()) curve[set.size - 1] += 1;
  return curve;
}

export type LifecycleWeek = { week: string; new: number; returning: number; resurrected: number; churned: number };

/**
 * Weekly lifecycle for the weeks from `from` to `to`: new (first seen that week), returning (also active the week
 * before), resurrected (back after at least a week away) and churned (active the week before, not this week; shown as a
 * negative bar). `rows` should reach back before `from` so returning users are not counted as new.
 */
export function lifecycle(rows: EventRow[], from: string, to: string): LifecycleWeek[] {
  const first = firstSeen(rows);
  const weeksOf = new Map<string, Set<string>>();
  for (const r of rows) {
    const w = weekStart(r.day);
    (weeksOf.get(w) ?? weeksOf.set(w, new Set()).get(w)!).add(r.userKey);
  }
  const out: LifecycleWeek[] = [];
  for (let n = dayNum(weekStart(from)); n <= dayNum(to); n += 7) {
    const week = numDay(n);
    const prev = weeksOf.get(numDay(n - 7)) ?? new Set<string>();
    const now = weeksOf.get(week) ?? new Set<string>();
    const row: LifecycleWeek = { week, new: 0, returning: 0, resurrected: 0, churned: 0 };
    for (const u of now) {
      if (weekStart(first.get(u)!) === week) row.new += 1;
      else if (prev.has(u)) row.returning += 1;
      else row.resurrected += 1;
    }
    for (const u of prev) if (!now.has(u)) row.churned += 1;
    out.push(row);
  }
  return out;
}

export type DailyCohort = { day: string; size: number; retained: (number | null)[] };

/** Daily cohorts of first-seen people: the share active again on day +1 .. +`span` (null for days not yet reached). */
export function dailyCohorts(rows: EventRow[], from: string, to: string, span = 14): DailyCohort[] {
  const first = firstSeen(rows);
  const active = new Map<string, Set<number>>();
  for (const r of rows) (active.get(r.userKey) ?? active.set(r.userKey, new Set()).get(r.userKey)!).add(dayNum(r.day));
  const cohorts = new Map<string, string[]>();
  for (const [u, d] of first) if (d >= from && d <= to) (cohorts.get(d) ?? cohorts.set(d, []).get(d)!).push(u);
  const end = dayNum(to);
  return [...cohorts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, users]) => {
      const start = dayNum(day);
      return {
        day,
        size: users.length,
        retained: Array.from({ length: span }, (_, i) =>
          start + i + 1 > end ? null : users.filter((u) => active.get(u)!.has(start + i + 1)).length / users.length),
      };
    });
}

export type FeatureRow = { event: string; users: number; adoption: number | null; repeat: number | null; count: number };

/**
 * Feature adoption: the share of active people who used each feature, and "repeat", the share of those who used it
 * again on a later day. Navigation and state events are left out.
 */
export function featureAdoption(rows: EventRow[]): FeatureRow[] {
  const active = new Set(rows.map((r) => r.userKey));
  const days = new Map<string, Map<string, Set<string>>>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (PASSIVE.has(r.event) || r.event === 'signed_up' || r.event === 'signed_out') continue;
    bump(counts, r.event);
    const byUser = days.get(r.event) ?? days.set(r.event, new Map()).get(r.event)!;
    (byUser.get(r.userKey) ?? byUser.set(r.userKey, new Set()).get(r.userKey)!).add(r.day);
  }
  return [...days.entries()]
    .map(([event, byUser]) => {
      const users = byUser.size;
      const repeaters = [...byUser.values()].filter((d) => d.size > 1).length;
      return { event, users, adoption: share(users, active.size), repeat: share(repeaters, users), count: counts.get(event) ?? 0 };
    })
    .sort((a, b) => b.users - a.users || a.event.localeCompare(b.event));
}

export type SnapshotMix = Record<'positions' | 'portfolios' | 'classes' | 'ledger_age', { key: string; n: number }[]>;

/** The latest account_snapshot per person, counted per bucket. */
export function snapshotMix(rows: EventRow[]): SnapshotMix {
  const latest = new Map<string, EventRow>();
  for (const r of rows) if (r.event === 'account_snapshot' && (!latest.has(r.userKey) || latest.get(r.userKey)!.ts < r.ts)) latest.set(r.userKey, r);
  const mix = { positions: new Map(), portfolios: new Map(), classes: new Map(), ledger_age: new Map() } as Record<keyof SnapshotMix, Map<string, number>>;
  for (const r of latest.values()) for (const k of Object.keys(mix) as (keyof SnapshotMix)[]) if (r.props[k]) bump(mix[k], r.props[k]);
  const out = {} as SnapshotMix;
  for (const k of Object.keys(mix) as (keyof SnapshotMix)[]) out[k] = [...mix[k].entries()].map(([key, n]) => ({ key, n }));
  return out;
}
