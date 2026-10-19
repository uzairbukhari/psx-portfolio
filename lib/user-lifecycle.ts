// Pure rules for the admin People view: how far each account got, which follow-up list it belongs to, and how its events
// read as sessions. Shared-safe (no clock, no I/O). The inputs are flags and day counts the store computes from
// analytics events; nothing here sees an amount, a ticker or a name of anything the user owns.

export const STAGES = ['signed_up', 'vault', 'content', 'sip_targets', 'picks', 'habit'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  signed_up: 'Signed up',
  vault: 'Created a vault',
  content: 'Added an entry, import or asset',
  sip_targets: 'Saved SIP targets',
  picks: 'Ran Monthly Picks',
  habit: 'Active on 3+ days this month',
};

export const SEGMENTS = ['no_vault', 'vault_no_content', 'inactive_14d', 'sip_once', 'erroring', 'no_events'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_LABEL: Record<Segment, string> = {
  no_vault: 'Signed up, no vault',
  vault_no_content: 'Vault but nothing added',
  inactive_14d: 'Quiet for 14+ days',
  sip_once: 'Tried SIP once, never again',
  erroring: 'Repeated errors this week',
  no_events: 'No usage events',
};

export type UserSummary = {
  /** PKT day (YYYY-MM-DD) the account first signed in. */
  firstSeenDay: string;
  /** PKT day of the latest sign-in or event. */
  lastActiveDay: string;
  origin: string;
  vaultCreated: boolean;
  vaultExists: boolean;
  content: boolean;
  targets: boolean;
  picks: boolean;
  /** Days with events in the last 30. */
  activeDays30: number;
  errors7: number;
  /** Distinct days with a SIP targets or picks event. */
  sipDays: number;
  lastSipDay: string | null;
  /** Any event beyond the server's own sign-in records; false when the person switched analytics off. */
  hasUsage: boolean;
};

export function daysBetween(from: string, to: string): number {
  const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

const hasVault = (s: UserSummary) => s.vaultCreated || s.vaultExists || s.origin === 'existing';

/** The furthest step reached. An account that predates analytics counts as having a vault. */
export function stageOf(s: UserSummary): Stage {
  if (s.picks && s.content && s.activeDays30 >= 3) return 'habit';
  if (s.picks) return 'picks';
  if (s.targets) return 'sip_targets';
  if (s.content) return 'content';
  if (hasVault(s)) return 'vault';
  return 'signed_up';
}

export function segmentsOf(s: UserSummary, today: string): Segment[] {
  const out: Segment[] = [];
  const vault = hasVault(s);
  if (!vault && daysBetween(s.firstSeenDay, today) >= 2) out.push('no_vault');
  if (vault && !s.content) out.push('vault_no_content');
  if (daysBetween(s.lastActiveDay, today) >= 14) out.push('inactive_14d');
  if (s.sipDays === 1 && s.lastSipDay && daysBetween(s.lastSipDay, today) >= 30) out.push('sip_once');
  if (s.errors7 >= 3) out.push('erroring');
  if (!s.hasUsage) out.push('no_events');
  return out;
}

const SCREEN_LABEL: Record<string, string> = {
  holdings: 'Holdings', reports: 'Insights', sip: 'Monthly Picks', activity: 'Activity', overview: 'Overview', company: 'Company',
  settings: 'Settings', notifications: 'Notifications', inbox: 'Inbox', today: 'Today', portfolio: 'Portfolio', plan: 'Plan',
  more: 'More', gold_silver: 'Gold & silver', funds: 'Funds', plans: 'Savings plans', landing: 'Landing', privacy: 'Privacy',
  terms: 'Terms', sign_in: 'Sign in',
};

const words = (v: string) => v.replaceAll('_', ' ');
const sentence = (v: string) => { const t = words(v); return t[0].toUpperCase() + t.slice(1); };

export function eventLabel(event: string, props: Record<string, string>): string {
  if (event === 'screen_viewed') return SCREEN_LABEL[props.screen] ?? sentence(props.screen ?? 'screen');
  const extra = Object.values(props).map(words).join(', ');
  return extra ? `${sentence(event)} (${extra})` : sentence(event);
}

export type TimelineEvent = { ts: string; sessionId: string; platform: string; appVersion: string | null; event: string; props: string | null };
export type TimelineItem = { ts: string; label: string };
export type TimelineSession = { id: string; start: string; end: string; platform: string; version: string | null; items: TimelineItem[] };

const parseProps = (raw: string | null): Record<string, string> => {
  if (!raw) return {};
  try { return JSON.parse(raw) as Record<string, string>; } catch { return {}; }
};

/**
 * Groups events (oldest first) into sessions, newest session first. Consecutive screen views collapse into one line
 * ("Holdings › Insights › Plan") so the path reads at a glance.
 */
export function groupTimeline(events: TimelineEvent[]): TimelineSession[] {
  const bySession = new Map<string, TimelineSession>();
  const runs = new Map<string, { item: TimelineItem; names: string[] }>();
  for (const e of events) {
    let session = bySession.get(e.sessionId);
    if (!session) {
      session = { id: e.sessionId, start: e.ts, end: e.ts, platform: e.platform, version: e.appVersion, items: [] };
      bySession.set(e.sessionId, session);
    }
    session.end = e.ts;
    const label = eventLabel(e.event, parseProps(e.props));
    if (e.event === 'screen_viewed') {
      const run = runs.get(e.sessionId);
      if (run && session.items[session.items.length - 1] === run.item) {
        run.names.push(label);
        run.item.label = run.names.join(' › ');
      } else {
        const item = { ts: e.ts, label };
        session.items.push(item);
        runs.set(e.sessionId, { item, names: [label] });
      }
    } else {
      session.items.push({ ts: e.ts, label });
    }
  }
  return [...bySession.values()].sort((a, b) => (a.start < b.start ? 1 : -1));
}
