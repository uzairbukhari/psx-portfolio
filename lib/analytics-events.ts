// The usage-event catalog shared by the web app, the phone app and the server. Events carry feature and screen names
// only: every prop is a closed enum, there is no free text, and the server rejects anything outside this list. Never
// add a prop that could hold a ticker, an amount, a quantity, a price, a name or a note.
// Pure module (no Workers imports) so the phone app can import it.
import { ERROR_AREAS, ERROR_CODES } from './error-codes.ts';

export const PLATFORMS = ['web', 'android', 'ios', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

const SCREENS = [
  'landing', 'privacy', 'terms', 'sign_in', 'holdings', 'reports', 'sip', 'activity', 'overview', 'company',
  'settings', 'notifications', 'inbox', 'today', 'portfolio', 'plan', 'more', 'gold_silver', 'funds', 'plans',
] as const;
const IMPORT_SOURCES = ['ahl', 'finqalab', 'broker', 'ipo', 'backup'] as const;
const ENTRY_KINDS = ['buy', 'sell', 'dividend', 'bonus', 'split', 'opening', 'other'] as const;

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
  asset_added: { class: ['gold', 'silver', 'fund', 'plan'] },
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
  chart_range_changed: { range: ['1w', '1m', '3m', '6m', '1y', 'all'] },
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
