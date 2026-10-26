// Builds the response for each Analytics lens in the admin console (Summary, Journeys, Engagement, Acquisition,
// Quality) from loaded event rows. Pure module: the store loads rows, this shapes them, the route serves the result.
import { sources, signupsByWeek, audienceMix, versionAdoption, type AcquiredUser } from './analytics-acquisition.ts';
import { activeSeries, dailyCohorts, featureAdoption, lifecycle, powerCurve, snapshotMix } from './analytics-engagement.ts';
import { FUNNEL_PRESETS, funnel, pathAnchors, paths, timeToMilestones, type Step } from './analytics-journey.ts';
import { retentionCohorts } from './analytics-report.ts';
import { dayNum, daysBetween, filterRows, numDay, share, type EventRow, type LensFilter, type PlatformFilter, type Segment } from './analytics-rows.ts';
import { sessionize, sessionStats, type Session } from './analytics-sessions.ts';
import { errorRates, errorsByScreen, qualitySeries, timings, vitals, vitalScreens } from './analytics-quality.ts';

export const LENSES = ['summary', 'journeys', 'engagement', 'acquisition', 'quality'] as const;
export type Lens = (typeof LENSES)[number];

export type LensQuery = {
  lens: Lens;
  days: number;
  today: string;
  platform: PlatformFilter;
  segment: Segment;
  steps?: Step[];
  windowDays?: number;
  anchor?: string;
  direction?: 'next' | 'prev';
  vitalScreen?: string;
};

/** The days of history to load for a query: the window, the previous window for comparison, and 28 days of lead-in. */
export const historyDays = (days: number) => Math.min(180, days * 2 + 28);

export function windows(q: Pick<LensQuery, 'days' | 'today'>) {
  const to = q.today;
  const from = numDay(dayNum(to) - q.days + 1);
  const prevTo = numDay(dayNum(from) - 1);
  const prevFrom = numDay(dayNum(prevTo) - q.days + 1);
  return { from, to, prevFrom, prevTo };
}

export type Kpi = {
  id: string;
  label: string;
  value: number | null;
  previous: number | null;
  format: 'count' | 'pct' | 'duration';
  /** Which direction is good news. */
  better: 'up' | 'down';
  spark: number[];
  hint: string;
};

const ACTIVATING = new Set(['entry_added', 'import_completed', 'asset_added']);

function signupsIn(users: AcquiredUser[], from: string, to: string) {
  return users.filter((u) => u.origin !== 'existing' && u.firstDay >= from && u.firstDay <= to);
}

function activation(users: AcquiredUser[], all: EventRow[], from: string, to: string) {
  const list = signupsIn(users, from, to);
  const firstAct = new Map<string, number>();
  for (const r of all) if (ACTIVATING.has(r.event)) firstAct.set(r.userKey, Math.min(firstAct.get(r.userKey) ?? Infinity, dayNum(r.day)));
  return share(list.filter((u) => (firstAct.get(u.userKey) ?? Infinity) - dayNum(u.firstDay) <= 7).length, list.length);
}

function weekOneRetention(users: AcquiredUser[], all: EventRow[], from: string, to: string, today: string) {
  const days = new Map<string, Set<number>>();
  for (const r of all) (days.get(r.userKey) ?? days.set(r.userKey, new Set()).get(r.userKey)!).add(dayNum(r.day));
  const eligible = signupsIn(users, from, to).filter((u) => dayNum(u.firstDay) + 13 <= dayNum(today));
  return share(eligible.filter((u) => [...(days.get(u.userKey) ?? [])].some((d) => d - dayNum(u.firstDay) >= 7 && d - dayNum(u.firstDay) <= 13)).length, eligible.length);
}

const median = (s: Session[]) => sessionStats(s).medianMs;
const crashFree = (s: Session[]) => share(s.filter((x) => !x.crashed).length, s.length);

/** Seven daily points across the window, for the sparkline under each KPI. */
function sparkDays(from: string, to: string): [string, string][] {
  const all = daysBetween(from, to);
  const size = Math.max(1, Math.ceil(all.length / 7));
  const out: [string, string][] = [];
  for (let i = 0; i < all.length; i += size) out.push([all[i], all[Math.min(all.length - 1, i + size - 1)]]);
  return out;
}

export function summary(all: EventRow[], users: AcquiredUser[], q: LensQuery) {
  const w = windows(q);
  const cur = filterRows(all, { from: w.from, to: w.to, platform: q.platform, segment: q.segment });
  const prev = filterRows(all, { from: w.prevFrom, to: w.prevTo, platform: q.platform, segment: q.segment });
  const curS = sessionize(cur);
  const prevS = sessionize(prev);
  const spans = sparkDays(w.from, w.to);
  const slice = (rows: EventRow[], [a, b]: [string, string]) => rows.filter((r) => r.day >= a && r.day <= b);
  const kpis: Kpi[] = [
    { id: 'active', label: 'Active people', value: new Set(cur.map((r) => r.userKey)).size, previous: new Set(prev.map((r) => r.userKey)).size, format: 'count', better: 'up',
      spark: spans.map((s) => new Set(slice(cur, s).map((r) => r.userKey)).size), hint: 'People who opened the app at least once in the period.' },
    { id: 'signups', label: 'New sign-ups', value: signupsIn(users, w.from, w.to).length, previous: signupsIn(users, w.prevFrom, w.prevTo).length, format: 'count', better: 'up',
      spark: spans.map(([a, b]) => signupsIn(users, a, b).length), hint: 'New accounts created in the period (accounts from before analytics are left out).' },
    { id: 'activation', label: 'Activation', value: activation(users, all, w.from, w.to), previous: activation(users, all, w.prevFrom, w.prevTo), format: 'pct', better: 'up',
      spark: spans.map(([a, b]) => activation(users, all, a, b) ?? 0), hint: 'Share of new sign-ups who added a holding, an asset or an import within 7 days.' },
    { id: 'retention', label: 'Week-1 retention', value: weekOneRetention(users, all, w.from, w.to, q.today), previous: weekOneRetention(users, all, w.prevFrom, w.prevTo, q.today), format: 'pct', better: 'up',
      spark: [], hint: 'Share of new sign-ups who came back 7 to 13 days after signing up (only sign-ups at least 13 days old count).' },
    { id: 'session', label: 'Median visit', value: median(curS), previous: median(prevS), format: 'duration', better: 'up',
      spark: spans.map((s) => median(sessionize(slice(cur, s))) ?? 0), hint: 'Middle visit length. A visit ends after 30 minutes without activity.' },
    { id: 'crash_free', label: 'Crash-free visits', value: crashFree(curS), previous: crashFree(prevS), format: 'pct', better: 'up',
      spark: spans.map((s) => crashFree(sessionize(slice(cur, s))) ?? 1), hint: 'Share of visits without an uncaught error.' },
  ];
  const changes = kpis
    .filter((k) => k.value !== null && k.previous !== null && k.value !== k.previous)
    .map((k) => {
      const delta = k.format === 'pct' ? (k.value! - k.previous!) * 100 : k.previous ? (k.value! - k.previous!) / k.previous! * 100 : null;
      return { id: k.id, label: k.label, delta, unit: k.format === 'pct' ? 'pts' : '%', good: delta === null ? null : (delta > 0) === (k.better === 'up') };
    })
    .filter((c) => c.delta !== null && Math.abs(c.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
  const active = activeSeries(all.filter((r) => q.platform === 'all' || r.platform === q.platform), w.from, w.to);
  const act = funnel(cur, FUNNEL_PRESETS[0].steps, 14);
  return { kpis, changes, active, activationFunnel: act };
}

export function journeys(all: EventRow[], q: LensQuery) {
  const w = windows(q);
  const cur = filterRows(all, { from: w.from, to: w.to, platform: q.platform, segment: q.segment });
  const sessions = sessionize(cur);
  const steps = q.steps?.length ? q.steps : FUNNEL_PRESETS[0].steps;
  const anchors = pathAnchors(sessions);
  const anchor = q.anchor && anchors.includes(q.anchor) ? q.anchor : (anchors.find((a) => a === 'screen:holdings') ?? anchors[0] ?? 'screen:holdings');
  return {
    presets: FUNNEL_PRESETS,
    steps,
    windowDays: q.windowDays ?? 14,
    funnel: funnel(cur, steps, q.windowDays ?? 14),
    anchors,
    anchor,
    direction: q.direction ?? 'next',
    paths: paths(sessions, anchor, q.direction ?? 'next', 3),
    milestones: timeToMilestones(cur),
    onboarding: funnel(cur, FUNNEL_PRESETS.find((p) => p.id === 'onboarding')!.steps, 30),
  };
}

export function engagement(all: EventRow[], users: AcquiredUser[], q: LensQuery) {
  const w = windows(q);
  const f: LensFilter = { from: w.from, to: w.to, platform: q.platform, segment: q.segment };
  const cur = filterRows(all, f);
  const platformRows = all.filter((r) => q.platform === 'all' || r.platform === q.platform);
  const sessions = sessionize(cur);
  const signups = users.filter((u) => u.origin !== 'existing' && u.firstDay >= numDay(dayNum(q.today) - 7 * 8)).map((u) => ({ userKey: u.userKey, day: u.firstDay }));
  return {
    active: activeSeries(platformRows, w.from, w.to),
    power: powerCurve(platformRows, w.to),
    lifecycle: lifecycle(platformRows, w.from, w.to),
    weekly: retentionCohorts(signups, platformRows.map((r) => ({ userKey: r.userKey, day: r.day })), q.today, 8),
    daily: dailyCohorts(platformRows, w.from, w.to, 14),
    features: featureAdoption(cur).slice(0, 30),
    sessions: sessionStats(sessions),
    snapshot: snapshotMix(cur),
  };
}

export function acquisition(all: EventRow[], users: AcquiredUser[], q: LensQuery) {
  const w = windows(q);
  const cur = filterRows(all, { from: w.from, to: w.to, platform: q.platform, segment: q.segment });
  return {
    channels: sources(users, all, w.from, w.to, 'ref'),
    buttons: sources(users, all, w.from, w.to, 'src'),
    weekly: signupsByWeek(users, w.from, w.to),
    mix: audienceMix(cur),
    versions: versionAdoption(cur, w.from, w.to),
  };
}

export function quality(all: EventRow[], q: LensQuery) {
  const w = windows(q);
  const cur = filterRows(all, { from: w.from, to: w.to, platform: q.platform, segment: q.segment });
  const sessions = sessionize(cur);
  const screens = vitalScreens(cur);
  return {
    series: qualitySeries(sessions, w.from, w.to),
    byVersion: errorRates(sessions, (s) => `${s.platform} ${s.appVersion ?? 'unknown'}`),
    byPlatform: errorRates(sessions, (s) => s.platform, 1),
    byScreen: errorsByScreen(sessions).slice(0, 12),
    vitals: vitals(cur, q.vitalScreen && screens.includes(q.vitalScreen) ? q.vitalScreen : undefined),
    vitalScreens: screens,
    vitalScreen: q.vitalScreen && screens.includes(q.vitalScreen) ? q.vitalScreen : null,
    timings: timings(cur),
  };
}

export function buildLens(all: EventRow[], users: AcquiredUser[], q: LensQuery) {
  const w = windows(q);
  const base = { lens: q.lens, days: q.days, from: w.from, to: w.to, prevFrom: w.prevFrom, prevTo: w.prevTo, platform: q.platform, segment: q.segment };
  switch (q.lens) {
    case 'summary': return { ...base, ...summary(all, users, q) };
    case 'journeys': return { ...base, ...journeys(all, q) };
    case 'engagement': return { ...base, ...engagement(all, users, q) };
    case 'acquisition': return { ...base, ...acquisition(all, users, q) };
    case 'quality': return { ...base, ...quality(all, q) };
  }
}

export type LensResponse<L extends Lens> = ReturnType<
  L extends 'summary' ? typeof summary : L extends 'journeys' ? typeof journeys : L extends 'engagement' ? typeof engagement : L extends 'acquisition' ? typeof acquisition : typeof quality
> & { lens: L; days: number; from: string; to: string; prevFrom: string; prevTo: string; platform: PlatformFilter; segment: Segment; generatedAt: string };
