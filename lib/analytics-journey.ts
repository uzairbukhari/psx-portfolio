// Journeys: ordered funnels, the paths people take around a screen or action, and how long the first steps take.
// Pure module.
import { EVENT_CATALOG, type EventName } from './analytics-events.ts';
import { bump, quantile, share, tsMs, type EventRow } from './analytics-rows.ts';
import type { Session } from './analytics-sessions.ts';

/**
 * A funnel step: one or more alternatives separated by `|`, each an event name with an optional prop match, for example
 * `screen_viewed:screen=reports` or `entry_added|import_completed`.
 */
export type Step = string;

type Matcher = { event: string; prop?: string; value?: string };

/** Parses a step, or null when it names something outside the catalog. */
export function parseStep(step: string): Matcher[] | null {
  const parts = step.split('|').map((p) => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const out: Matcher[] = [];
  for (const part of parts) {
    const m = /^([a-z_]{1,40})(?::([a-z_]{1,20})=([a-z0-9_]{1,20}))?$/.exec(part);
    if (!m || !Object.hasOwn(EVENT_CATALOG, m[1])) return null;
    const allowed = EVENT_CATALOG[m[1] as EventName] as Record<string, readonly string[]>;
    if (m[2] && !(Object.hasOwn(allowed, m[2]) && allowed[m[2]].includes(m[3]))) return null;
    out.push(m[2] ? { event: m[1], prop: m[2], value: m[3] } : { event: m[1] });
  }
  return out;
}

const matches = (r: EventRow, ms: Matcher[]) => ms.some((m) => r.event === m.event && (!m.prop || r.props[m.prop] === m.value));

/** Ready-made funnels for the Journeys lens. */
export const FUNNEL_PRESETS: { id: string; name: string; steps: Step[] }[] = [
  { id: 'activation', name: 'Activation', steps: ['signed_up', 'vault_created', 'entry_added|import_completed|asset_added', 'screen_viewed:screen=reports'] },
  { id: 'import', name: 'Statement import', steps: ['import_started', 'import_completed'] },
  { id: 'picks', name: 'Monthly Picks', steps: ['screen_viewed:screen=sip', 'targets_saved', 'picks_run_started', 'picks_run_completed'] },
  { id: 'add_entry', name: 'Add a transaction', steps: ['dialog_opened:dialog=add_entry', 'dialog_closed:outcome=done'] },
  { id: 'onboarding', name: 'Onboarding checklist', steps: ['onboarding_step_done:step=vault', 'onboarding_step_done:step=first_holding', 'onboarding_step_done:step=backup', 'onboarding_step_done:step=sip_budget'] },
];

export type FunnelStep = {
  step: Step;
  users: number;
  /** Share of the people who entered the funnel. */
  overall: number | null;
  /** Share of the people who reached the previous step. */
  fromPrevious: number | null;
  medianMsFromPrevious: number | null;
  /** People who reached this step but not the next one (at most 50), for the People view. */
  dropped: string[];
};

/**
 * Strict-order funnel: each person enters at their first step-1 event, and every next step must come after the
 * previous one and within `windowDays` of entering.
 */
export function funnel(rows: EventRow[], steps: Step[], windowDays: number): FunnelStep[] {
  const matchers = steps.map(parseStep);
  if (matchers.some((m) => !m)) throw new Error('Unknown funnel step.');
  const ms = matchers as Matcher[][];
  const byUser = new Map<string, EventRow[]>();
  for (const r of rows) (byUser.get(r.userKey) ?? byUser.set(r.userKey, []).get(r.userKey)!).push(r);
  const reached = steps.map(() => [] as { user: string; at: number; gap: number | null }[]);
  const windowMs = windowDays * 86_400_000;
  for (const [user, list] of byUser) {
    list.sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
    const first = list.find((r) => matches(r, ms[0]));
    if (!first) continue;
    const start = tsMs(first.ts);
    reached[0].push({ user, at: start, gap: null });
    let prev = start;
    for (let i = 1; i < ms.length; i++) {
      const next = list.find((r) => tsMs(r.ts) >= prev && tsMs(r.ts) - start <= windowMs && matches(r, ms[i]));
      if (!next) break;
      const at = tsMs(next.ts);
      reached[i].push({ user, at, gap: at - prev });
      prev = at;
    }
  }
  return steps.map((step, i) => {
    const here = reached[i];
    const nextUsers = new Set((reached[i + 1] ?? []).map((x) => x.user));
    return {
      step,
      users: here.length,
      overall: share(here.length, reached[0].length),
      fromPrevious: i ? share(here.length, reached[i - 1].length) : null,
      medianMsFromPrevious: i ? quantile(here.map((x) => x.gap!), 0.5) : null,
      dropped: i < steps.length - 1 ? here.filter((x) => !nextUsers.has(x.user)).slice(0, 50).map((x) => x.user) : [],
    };
  });
}

/** One step of a visit for the path explorer: a screen (`screen:reports`) or an action (`entry_added`). */
function nodesOf(s: Session): string[] {
  const out: string[] = [];
  for (const r of s.rows) {
    const node = r.event === 'screen_viewed' && r.props.screen ? `screen:${r.props.screen}` : PATH_EVENTS.has(r.event) ? r.event : null;
    if (node && out.at(-1) !== node) out.push(node);
  }
  return out;
}
const PATH_EVENTS = new Set(['entry_added', 'entry_edited', 'entry_deleted', 'import_started', 'import_completed', 'import_failed', 'targets_saved', 'picks_run_completed', 'asset_added', 'portfolio_created', 'backup_exported', 'vault_created', 'vault_unlocked', 'signed_out', 'client_error']);

export type PathGraph = {
  nodes: { id: string; name: string; level: number; value: number }[];
  links: { source: string; target: string; value: number }[];
  sessions: number;
};

/**
 * What people do after (or before) a screen or action, `depth` steps out, as a Sankey graph. Each session counts once,
 * from its first time at the anchor. Rare steps at each level fold into "other"; a session that stops shows as "exit".
 */
export function paths(sessions: Session[], anchor: string, direction: 'next' | 'prev' = 'next', depth = 3, top = 6): PathGraph {
  const seqs: string[][] = [];
  for (const s of sessions) {
    const nodes = nodesOf(s);
    const i = nodes.indexOf(anchor);
    if (i < 0) continue;
    const seq = direction === 'next' ? nodes.slice(i, i + depth + 1) : nodes.slice(Math.max(0, i - depth), i + 1).reverse();
    while (seq.length < depth + 1) seq.push(direction === 'next' ? 'exit' : 'start');
    seqs.push(seq);
  }
  const keep: Set<string>[] = [];
  for (let level = 1; level <= depth; level++) {
    const c = new Map<string, number>();
    for (const seq of seqs) bump(c, seq[level]);
    keep[level] = new Set([...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k]) => k));
  }
  const nodeValue = new Map<string, number>();
  const linkValue = new Map<string, number>();
  for (const seq of seqs) {
    const named = seq.map((n, level) => (level === 0 || keep[level].has(n) ? n : 'other'));
    let prev = '';
    named.forEach((n, level) => {
      // Ids carry the column the node is drawn in: left to right in time, so "before" paths are mirrored.
      const id = `${direction === 'next' ? level : depth - level}:${n}`;
      bump(nodeValue, id);
      if (level) bump(linkValue, direction === 'next' ? `${prev}>${id}` : `${id}>${prev}`);
      prev = id;
    });
  }
  return {
    sessions: seqs.length,
    nodes: [...nodeValue.entries()].map(([id, value]) => {
      return { id, name: id.slice(id.indexOf(':') + 1), level: Number(id.slice(0, id.indexOf(':'))), value };
    }),
    links: [...linkValue.entries()].map(([k, value]) => {
      const [source, target] = k.split('>');
      return { source, target, value };
    }),
  };
}

/** The nodes the path explorer can start from: the screens and actions seen in these sessions, most common first. */
export function pathAnchors(sessions: Session[], top = 24): string[] {
  const c = new Map<string, number>();
  for (const s of sessions) for (const n of new Set(nodesOf(s))) bump(c, n);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k]) => k);
}

export const MILESTONES = [
  { id: 'vault', name: 'Vault created', events: ['vault_created'] },
  { id: 'first_entry', name: 'First holding added', events: ['entry_added', 'import_completed', 'asset_added'] },
  { id: 'first_insight', name: 'Opened Insights', events: ['report_viewed'], screen: 'reports' },
  { id: 'first_picks', name: 'First Monthly Picks run', events: ['picks_run_completed'] },
] as const;
export const TIME_BUCKETS = ['under 10 min', 'under 1 h', 'under 1 day', 'under 7 days', '7 days+'] as const;
const timeBucket = (ms: number) => (ms < 600_000 ? 0 : ms < 3_600_000 ? 1 : ms < 86_400_000 ? 2 : ms < 604_800_000 ? 3 : 4);

export type MilestoneTime = { id: string; name: string; started: number; reached: number; medianMs: number | null; buckets: { bucket: string; n: number }[] };

/** From sign-up (the first `signed_up`) to each milestone, for the people who signed up in `rows`. */
export function timeToMilestones(rows: EventRow[]): MilestoneTime[] {
  const byUser = new Map<string, EventRow[]>();
  for (const r of rows) (byUser.get(r.userKey) ?? byUser.set(r.userKey, []).get(r.userKey)!).push(r);
  return MILESTONES.map((m) => {
    const gaps: number[] = [];
    let started = 0;
    for (const list of byUser.values()) {
      const signup = list.filter((r) => r.event === 'signed_up').map((r) => tsMs(r.ts)).sort((a, b) => a - b)[0];
      if (signup === undefined) continue;
      started += 1;
      const hit = list
        .filter((r) => tsMs(r.ts) >= signup && ((m.events as readonly string[]).includes(r.event) || ('screen' in m && r.event === 'screen_viewed' && r.props.screen === m.screen)))
        .map((r) => tsMs(r.ts))
        .sort((a, b) => a - b)[0];
      if (hit !== undefined) gaps.push(hit - signup);
    }
    const buckets = TIME_BUCKETS.map((bucket) => ({ bucket, n: 0 }));
    for (const g of gaps) buckets[timeBucket(g)].n += 1;
    return { id: m.id, name: m.name, started, reached: gaps.length, medianMs: quantile(gaps, 0.5), buckets };
  });
}
