// The usage-event catalog shared by the web app, the phone app and the server. Events carry feature and screen names
// only: every prop is a closed enum, there is no free text, and the server rejects anything outside this list. Never
// add a prop that could hold a ticker, an amount, a quantity, a price, a name or a note.
// Pure module (no Workers imports) so the phone app can import it.
import { ERROR_AREAS, ERROR_CODES } from './error-codes.ts';

export const PLATFORMS = ['web', 'android', 'ios', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

const SCREENS = [
  'landing', 'privacy', 'terms', 'sign_in', 'holdings', 'reports', 'sip', 'activity', 'overview', 'company',
  'settings', 'notifications', 'inbox', 'today', 'portfolio', 'plan', 'more', 'gold_silver', 'funds', 'plans', 'future', 'zakat', 'feedback',
  'sip_tracker', 'research_desk', 'ai_lab', 'currency',
] as const;
const IMPORT_SOURCES = ['ahl', 'finqalab', 'broker', 'ipo', 'backup'] as const;
const ENTRY_KINDS = ['buy', 'sell', 'dividend', 'bonus', 'split', 'opening', 'other'] as const;
const DIALOGS = ['add_entry', 'trade', 'asset', 'import', 'targets', 'backup', 'vault_security', 'portfolio', 'company_add'] as const;
export const TIMING_BUCKETS = ['under_250ms', 'under_1s', 'under_3s', 'under_10s', 'over_10s'] as const;
/** Time vitals use TIMING_BUCKETS; CLS (unitless) uses its own three: under 0.1, under 0.25, above. */
const VITAL_BUCKETS = [...TIMING_BUCKETS, 'cls_low', 'cls_mid', 'cls_high'] as const;

/** The bucket a duration in milliseconds falls in. */
export function timingBucket(ms: number): (typeof TIMING_BUCKETS)[number] {
  return ms < 250 ? 'under_250ms' : ms < 1000 ? 'under_1s' : ms < 3000 ? 'under_3s' : ms < 10_000 ? 'under_10s' : 'over_10s';
}

/** Fixed size buckets for account_snapshot: how big an account is, never how much is in it. */
export const positionsBucket = (n: number) => (n <= 0 ? 'none' : n <= 5 ? 'p1_5' : n <= 20 ? 'p6_20' : 'p21_plus');
export const portfoliosBucket = (n: number) => (n <= 1 ? 'one' : n === 2 ? 'two' : 'three_plus');
export const clsBucket = (v: number) => (v < 0.1 ? 'cls_low' : v < 0.25 ? 'cls_mid' : 'cls_high');
export function ledgerAgeBucket(firstDay: string | null, today: string) {
  if (!firstDay) return 'empty';
  const days = (Date.parse(today) - Date.parse(firstDay)) / 86_400_000;
  return days < 7 ? 'week' : days < 30 ? 'month' : days < 180 ? 'half_year' : 'older';
}

/** event name -> prop name -> allowed values. An event with `{}` takes no props. */
export const EVENT_CATALOG = {
  // Account and vault
  signed_up: { platform: PLATFORMS },
  signed_in: { platform: PLATFORMS },
  signed_out: {},
  account_deleted: {},
  vault_created: {},
  vault_unlocked: { method: ['password', 'biometric'] },
  vault_recovered: {},
  backup_exported: {},
  // Account state: sent once per session even when usage sharing is off, so a new sign-up can be told from an
  // existing account (see resolveOrigin). Carries no data beyond whether the account already has a vault.
  account_state: { vault: ['none', 'exists'] },
  // Navigation
  app_opened: {},
  screen_viewed: { screen: SCREENS },
  landing_viewed: {},
  sign_in_clicked: {},
  // Ledger
  entry_added: { kind: ENTRY_KINDS },
  entry_edited: { kind: ENTRY_KINDS },
  entry_deleted: { kind: ENTRY_KINDS },
  // Imports
  import_started: { source: IMPORT_SOURCES },
  import_completed: { source: IMPORT_SOURCES },
  import_failed: { source: IMPORT_SOURCES },
  // Monthly SIP
  targets_saved: {},
  picks_run_started: {},
  picks_run_completed: {},
  picks_run_failed: {},
  // Other assets
  asset_added: { class: ['gold', 'silver', 'fund', 'plan', 'currency'] },
  plan_contribution_confirmed: {},
  plan_contribution_skipped: {},
  // Portfolios
  portfolio_created: {},
  portfolio_switched: {},
  // Market data and reports
  price_refresh_requested: {},
  dividend_approved: {},
  report_viewed: { report: ['summary', 'performance', 'income', 'allocation', 'tax', 'other'] },
  // Engagement
  notifications_enabled: {},
  theme_changed: { theme: ['light', 'dark', 'midnight', 'paper', 'system'] },
  sip_whatif_used: { kind: ['stop', 'raise', 'later', 'break', 'skip', 'extra', 'returns', 'fall', 'goal', 'custom'] },
  zakat_setup_done: { school: ['hanafi', 'shafii', 'maliki', 'hanbali', 'custom'], nisab: ['silver', 'gold'], year: ['lunar', 'solar'] },
  zakat_payment_logged: { kind: ['direct', 'organisation', 'bank', 'deducted', 'other'] },
  zakat_year_closed: { state: ['paid', 'partial', 'below_nisab'] },
  chart_range_changed: { range: ['1d', '1w', '1m', '3m', '6m', '1y', '3y', '5y', 'all'] },
  // Onboarding and help
  onboarding_step_done: { step: ['vault', 'first_holding', 'tax', 'backup', 'sip_budget', 'insights'] },
  onboarding_checklist: { action: ['shown', 'hidden', 'completed'] },
  tour_offered: {},
  tour_started: { source: ['auto', 'help'] },
  tour_step_viewed: { step: ['value', 'add', 'portfolios', 'pages', 'bell', 'profile'] },
  tour_finished: { outcome: ['completed', 'skipped', 'declined'], at_step: ['value', 'add', 'portfolios', 'pages', 'bell', 'profile', 'offer'] },
  tip_dismissed: { tip: ['insights', 'activity', 'company', 'sip_blueprint', 'picks', 'notifications'] },
  feedback_sent: { kind: ['contact', 'issue', 'feature'] },
  help_opened: { item: ['panel', 'tour', 'checklist', 'tips', 'faq', 'shortcuts', 'privacy', 'terms', 'contact', 'feedback'] },
  // Journeys: which dialogs people open and whether they finish them
  dialog_opened: { dialog: DIALOGS },
  dialog_closed: { dialog: DIALOGS, outcome: ['done', 'cancel'] },
  // Coarse shape of the account, once per session after unlock: fixed buckets only, never a count, amount or ticker
  account_snapshot: {
    positions: ['none', 'p1_5', 'p6_20', 'p21_plus'],
    portfolios: ['one', 'two', 'three_plus'],
    classes: ['stocks', 'other', 'multi', 'none'],
    ledger_age: ['week', 'month', 'half_year', 'older', 'empty'],
  },
  // Speed: Core Web Vitals on the web and timed steps everywhere, as rating and bucket only
  web_vital: { metric: ['lcp', 'inp', 'cls', 'fcp', 'ttfb'], rating: ['good', 'ni', 'poor'], bucket: VITAL_BUCKETS, screen: SCREENS },
  timing: { op: ['vault_unlock', 'first_holdings', 'picks_run', 'import_parse'], bucket: TIMING_BUCKETS },
  // Errors for the super-admin audit log (category, code and screen only: no message text, no stack)
  client_error: { area: ERROR_AREAS, code: ERROR_CODES, screen: SCREENS },
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type EventName = keyof typeof EVENT_CATALOG;
export type EventProps = Record<string, string>;

/** Events the server records itself at sign-in; a client may not send them. */
export const SERVER_EVENTS: readonly EventName[] = ['signed_up', 'signed_in'];

export type IncomingEvent = { event: EventName; props: EventProps };

/** Returns a clean event, or null when the name or any prop is outside the catalog. */
export function validateEvent(input: unknown): IncomingEvent | null {
  if (!input || typeof input !== 'object') return null;
  const { event, props } = input as { event?: unknown; props?: unknown };
  if (typeof event !== 'string' || !Object.hasOwn(EVENT_CATALOG, event)) return null;
  const allowed = EVENT_CATALOG[event as EventName] as Record<string, readonly string[]>;
  const clean: EventProps = {};
  if (props !== undefined && props !== null) {
    if (typeof props !== 'object' || Array.isArray(props)) return null;
    for (const [key, value] of Object.entries(props)) {
      if (!Object.hasOwn(allowed, key) || typeof value !== 'string' || !allowed[key].includes(value)) return null;
      clean[key] = value;
    }
  }
  return { event: event as EventName, props: clean };
}

const ID = /^[A-Za-z0-9-]{8,64}$/;
export const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);
export const cleanVersion = (value: unknown): string | null =>
  typeof value === 'string' && /^[0-9A-Za-z.+-]{1,20}$/.test(value) ? value : null;

export type EventBatch = {
  sessionId: string;
  anonId?: string;
  platform: Platform;
  appVersion?: string;
  events: IncomingEvent[];
};

export const MAX_BATCH = 50;

/** Validates a request body. Invalid events are dropped; a bad envelope rejects the whole batch (null). */
export function parseBatch(body: unknown): EventBatch | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!validId(b.sessionId) || !PLATFORMS.includes(b.platform as Platform) || !Array.isArray(b.events)) return null;
  if (b.anonId !== undefined && !validId(b.anonId)) return null;
  const events: IncomingEvent[] = [];
  for (const raw of b.events.slice(0, MAX_BATCH)) {
    const e = validateEvent(raw);
    if (e && !SERVER_EVENTS.includes(e.event)) events.push(e);
  }
  return {
    sessionId: b.sessionId,
    anonId: b.anonId as string | undefined,
    platform: b.platform as Platform,
    appVersion: cleanVersion(b.appVersion) ?? undefined,
    events,
  };
}
