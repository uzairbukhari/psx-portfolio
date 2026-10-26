// The event row every analytics lens works on (Journeys, Engagement, Acquisition, Quality), plus the small helpers they
// share. Rows come from `analytics_events` (lib/analytics-store.ts#loadEventRows); props are closed-enum values only.
// Pure module: no Workers imports and no clock, so tests run the lenses on synthetic rows.
import { DAY_MS } from './analytics-report.ts';

export type EventRow = {
  ts: string;
  day: string;
  userKey: string;
  sessionId: string;
  platform: string;
  appVersion: string | null;
  event: string;
  props: Record<string, string>;
  country: string | null;
  os: string | null;
  browser: string | null;
  formFactor: string | null;
};

export type RawEventRow = Omit<EventRow, 'props'> & { props: string | null };

export function parseRow(r: RawEventRow): EventRow {
  let props: Record<string, string> = {};
  if (r.props) {
    try {
      props = JSON.parse(r.props) as Record<string, string>;
    } catch {
      props = {};
    }
  }
  return { ...r, props };
}

export const PLATFORM_FILTERS = ['all', 'web', 'android', 'ios'] as const;
export type PlatformFilter = (typeof PLATFORM_FILTERS)[number];
export const SEGMENTS = ['all', 'new', 'returning'] as const;
export type Segment = (typeof SEGMENTS)[number];

export type LensFilter = { from: string; to: string; platform: PlatformFilter; segment: Segment };

/**
 * Applies the filter bar. `new` keeps people whose first event in the loaded history falls inside the window, and
 * `returning` the others (rows are loaded with the history before the window for this reason).
 */
export function filterRows(rows: EventRow[], f: LensFilter): EventRow[] {
  const first = firstSeen(rows);
  return rows.filter((r) => {
    if (r.day < f.from || r.day > f.to) return false;
    if (f.platform !== 'all' && r.platform !== f.platform) return false;
    if (f.segment === 'all') return true;
    const isNew = (first.get(r.userKey) ?? r.day) >= f.from;
    return f.segment === 'new' ? isNew : !isNew;
  });
}

/** The first day each person shows up in `rows`. */
export function firstSeen(rows: EventRow[]): Map<string, string> {
  const first = new Map<string, string>();
  for (const r of rows) {
    const d = first.get(r.userKey);
    if (!d || r.day < d) first.set(r.userKey, r.day);
  }
  return first;
}

export const dayNum = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
export const numDay = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const tsMs = (ts: string) => Date.parse(ts);

/** Every day from `from` to `to`, inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = dayNum(from); n <= dayNum(to); n++) out.push(numDay(n));
  return out;
}

/** The value at quantile q (0..1) of a list of numbers, or null when the list is empty. */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i];
}

/** Counts per key, largest first; keys past `top` fold into `other`. */
export function ranked(counts: Map<string, number>, top = 10): { key: string; n: number }[] {
  const list = [...counts.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  if (list.length <= top) return list;
  const rest = list.slice(top - 1).reduce((s, x) => s + x.n, 0);
  return [...list.slice(0, top - 1), { key: 'other', n: rest }];
}

export const bump = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

/** A share as 0..1, or null when there is nothing to divide by. */
export const share = (part: number, whole: number) => (whole ? part / whole : null);

/** Events that only record navigation or state, not something the person did. */
export const PASSIVE = new Set(['app_opened', 'screen_viewed', 'account_state', 'account_snapshot', 'web_vital', 'timing', 'client_error', 'signed_in', 'dialog_opened', 'dialog_closed']);
