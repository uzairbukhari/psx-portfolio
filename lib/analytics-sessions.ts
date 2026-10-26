// Sessions for the analytics lenses: one app visit, from the client's session id, split again after 30 minutes without
// an event (a tab left open overnight is two visits). Pure module.
import { bump, PASSIVE, quantile, ranked, share, tsMs, type EventRow } from './analytics-rows.ts';

export const IDLE_MS = 30 * 60_000;

export type Session = {
  id: string;
  userKey: string;
  platform: string;
  appVersion: string | null;
  day: string;
  start: number;
  end: number;
  screens: string[];
  actions: number;
  errors: number;
  crashed: boolean;
  rows: EventRow[];
};

/** Builds sessions from rows (any order). */
export function sessionize(rows: EventRow[]): Session[] {
  const byClient = new Map<string, EventRow[]>();
  for (const r of rows) {
    const k = `${r.userKey}|${r.sessionId}`;
    (byClient.get(k) ?? byClient.set(k, []).get(k)!).push(r);
  }
  const out: Session[] = [];
  for (const [k, list] of byClient) {
    list.sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
    let current: Session | null = null;
    let part = 0;
    for (const r of list) {
      const t = tsMs(r.ts);
      if (!current || t - current.end > IDLE_MS) {
        current = { id: `${k}#${part++}`, userKey: r.userKey, platform: r.platform, appVersion: r.appVersion, day: r.day, start: t, end: t, screens: [], actions: 0, errors: 0, crashed: false, rows: [] };
        out.push(current);
      }
      current.end = t;
      current.rows.push(r);
      if (r.event === 'screen_viewed' && r.props.screen && current.screens.at(-1) !== r.props.screen) current.screens.push(r.props.screen);
      if (r.event === 'client_error') {
        current.errors += 1;
        if (isCrash(r)) current.crashed = true;
      }
      if (!PASSIVE.has(r.event)) current.actions += 1;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** An uncaught error: the app (or a screen) fell over, as opposed to a handled failure such as a bad import file. */
export const isCrash = (r: EventRow) => r.event === 'client_error' && r.props.code === 'uncaught';

export const DURATION_BUCKETS = ['under 1 min', '1–3 min', '3–10 min', '10–30 min', '30 min+'] as const;
export const DEPTH_BUCKETS = ['1 screen', '2 screens', '3–5', '6–10', '11+'] as const;

const durationBucket = (ms: number) => (ms < 60_000 ? 0 : ms < 180_000 ? 1 : ms < 600_000 ? 2 : ms < 1_800_000 ? 3 : 4);
const depthBucket = (n: number) => (n <= 1 ? 0 : n === 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4);

export type SessionStats = {
  sessions: number;
  users: number;
  medianMs: number | null;
  p75Ms: number | null;
  avgScreens: number | null;
  bounceRate: number | null;
  perUserDay: number | null;
  duration: { bucket: string; n: number }[];
  depth: { bucket: string; n: number }[];
  entry: { key: string; n: number }[];
  exit: { key: string; n: number }[];
};

/** Length, depth, bounce (one screen and nothing done) and where visits start and end. */
export function sessionStats(sessions: Session[]): SessionStats {
  const durations = sessions.map((s) => s.end - s.start);
  const duration = DURATION_BUCKETS.map((bucket) => ({ bucket, n: 0 }));
  const depth = DEPTH_BUCKETS.map((bucket) => ({ bucket, n: 0 }));
  const entry = new Map<string, number>();
  const exit = new Map<string, number>();
  const userDays = new Set<string>();
  let bounces = 0;
  let screens = 0;
  for (const s of sessions) {
    duration[durationBucket(s.end - s.start)].n += 1;
    depth[depthBucket(Math.max(1, s.screens.length))].n += 1;
    if (s.screens.length) {
      bump(entry, s.screens[0]);
      bump(exit, s.screens.at(-1)!);
    }
    if (s.screens.length <= 1 && s.actions === 0) bounces += 1;
    screens += s.screens.length;
    userDays.add(`${s.userKey}|${s.day}`);
  }
  return {
    sessions: sessions.length,
    users: new Set(sessions.map((s) => s.userKey)).size,
    medianMs: quantile(durations, 0.5),
    p75Ms: quantile(durations, 0.75),
    avgScreens: sessions.length ? screens / sessions.length : null,
    bounceRate: share(bounces, sessions.length),
    perUserDay: userDays.size ? sessions.length / userDays.size : null,
    duration,
    depth,
    entry: ranked(entry, 8),
    exit: ranked(exit, 8),
  };
}
