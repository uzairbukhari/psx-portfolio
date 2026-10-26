// Quality: crash-free and error-free visits, errors per 1,000 visits by release, screen and platform, Core Web Vitals
// and timed steps, and the screen people were on when something failed. Pure module.
import { bump, daysBetween, share, type EventRow } from './analytics-rows.ts';
import type { Session } from './analytics-sessions.ts';

export type QualityDay = { day: string; sessions: number; errorFree: number | null; crashFree: number | null };

/** Per day: visits, and the share with no error and with no crash. */
export function qualitySeries(sessions: Session[], from: string, to: string): QualityDay[] {
  const byDay = new Map<string, Session[]>();
  for (const s of sessions) (byDay.get(s.day) ?? byDay.set(s.day, []).get(s.day)!).push(s);
  return daysBetween(from, to).map((day) => {
    const list = byDay.get(day) ?? [];
    return { day, sessions: list.length, errorFree: share(list.filter((s) => !s.errors).length, list.length), crashFree: share(list.filter((s) => !s.crashed).length, list.length) };
  });
}

export type ErrorRate = { key: string; sessions: number; errors: number; per1k: number | null };

/** Errors per 1,000 visits, grouped by a session property. Groups under `minSessions` visits are left out as noise. */
export function errorRates(sessions: Session[], keyOf: (s: Session) => string, minSessions = 5): ErrorRate[] {
  const n = new Map<string, number>();
  const e = new Map<string, number>();
  for (const s of sessions) {
    const k = keyOf(s);
    bump(n, k);
    bump(e, k, s.errors);
  }
  return [...n.entries()]
    .filter(([, count]) => count >= minSessions)
    .map(([key, count]) => ({ key, sessions: count, errors: e.get(key) ?? 0, per1k: ((e.get(key) ?? 0) / count) * 1000 }))
    .sort((a, b) => (b.per1k ?? 0) - (a.per1k ?? 0));
}

/** Where errors happened: the error's own screen, else the last screen viewed before it in the visit. */
export function errorsByScreen(sessions: Session[]): { key: string; n: number; codes: { key: string; n: number }[] }[] {
  const out = new Map<string, Map<string, number>>();
  for (const s of sessions) {
    let screen = 'unknown';
    for (const r of s.rows) {
      if (r.event === 'screen_viewed' && r.props.screen) screen = r.props.screen;
      if (r.event !== 'client_error') continue;
      const where = r.props.screen ?? screen;
      bump(out.get(where) ?? out.set(where, new Map()).get(where)!, `${r.props.area ?? 'other'}/${r.props.code ?? 'unknown'}`);
    }
  }
  return [...out.entries()]
    .map(([key, codes]) => ({
      key,
      n: [...codes.values()].reduce((a, b) => a + b, 0),
      codes: [...codes.entries()].map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n).slice(0, 5),
    }))
    .sort((a, b) => b.n - a.n);
}

export const VITALS = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const;
const TIME_ORDER = ['under_250ms', 'under_1s', 'under_3s', 'under_10s', 'over_10s'];
const CLS_ORDER = ['cls_low', 'cls_mid', 'cls_high'];

export type VitalSummary = {
  metric: string;
  samples: number;
  good: number | null;
  ni: number | null;
  poor: number | null;
  /** The bucket that holds the 75th percentile (Google's threshold point). */
  p75: string | null;
  rating: 'good' | 'ni' | 'poor' | null;
};

/** The bucket at which the cumulative share first reaches q. */
function bucketQuantile(counts: Map<string, number>, order: string[], q: number): string | null {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (!total) return null;
  let run = 0;
  for (const b of order) {
    run += counts.get(b) ?? 0;
    if (run / total >= q) return b;
  }
  return order.at(-1)!;
}

/** Core Web Vitals: rating shares and the p75 bucket per metric, optionally only for one screen. */
export function vitals(rows: EventRow[], screen?: string): VitalSummary[] {
  return VITALS.map((metric) => {
    const list = rows.filter((r) => r.event === 'web_vital' && r.props.metric === metric && (!screen || r.props.screen === screen));
    const ratings = new Map<string, number>();
    const buckets = new Map<string, number>();
    for (const r of list) {
      bump(ratings, r.props.rating);
      bump(buckets, r.props.bucket);
    }
    const good = share(ratings.get('good') ?? 0, list.length);
    const poor = share(ratings.get('poor') ?? 0, list.length);
    // Google's rule: good when 75% of visits are good, poor when more than 25% are poor.
    const rating = good === null ? null : good >= 0.75 ? 'good' : (poor ?? 0) > 0.25 ? 'poor' : 'ni';
    return { metric, samples: list.length, good, ni: share(ratings.get('ni') ?? 0, list.length), poor, p75: bucketQuantile(buckets, metric === 'cls' ? CLS_ORDER : TIME_ORDER, 0.75), rating };
  });
}

/** Screens with web-vital samples, most sampled first. */
export function vitalScreens(rows: EventRow[]): string[] {
  const c = new Map<string, number>();
  for (const r of rows) if (r.event === 'web_vital' && r.props.screen) bump(c, r.props.screen);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Timed steps (vault unlock, Monthly Picks, ...): count per bucket and the median bucket. */
export function timings(rows: EventRow[]): { op: string; samples: number; buckets: { bucket: string; n: number }[]; p50: string | null; p90: string | null }[] {
  const byOp = new Map<string, Map<string, number>>();
  for (const r of rows) if (r.event === 'timing') bump(byOp.get(r.props.op) ?? byOp.set(r.props.op, new Map()).get(r.props.op)!, r.props.bucket);
  return [...byOp.entries()].map(([op, counts]) => ({
    op,
    samples: [...counts.values()].reduce((a, b) => a + b, 0),
    buckets: TIME_ORDER.map((bucket) => ({ bucket, n: counts.get(bucket) ?? 0 })),
    p50: bucketQuantile(counts, TIME_ORDER, 0.5),
    p90: bucketQuantile(counts, TIME_ORDER, 0.9),
  }));
}
