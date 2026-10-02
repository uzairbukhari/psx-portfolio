// Load-time bookkeeping for PSX dividend announcements, shared by the web dashboard and the mobile app so
// either one alone keeps expected dividends and payout alerts current: book cash dividends whose book
// closure has started as *expected* dividends, post payout news, and save once through the revisioned PUT.
import {
  pendingAutoDividends,
  startDividendTracking,
  today,
  validate,
  type AppNotification,
  type Dividend,
  type Portfolio,
} from './portfolio.ts';
import { addNotifications, announcementNotifications, dividendNotifications } from './notifications.ts';
import type { PayoutAnnouncement } from './psx-payouts.ts';
import type { FaceValueEvidence } from './face-values.ts';

export type FaceValueEvidenceMap = Record<string, FaceValueEvidence[]>;

/** Tries (initial save plus conflict retries) before giving up; a later load simply tries again. */
export const MAX_SYNC_ATTEMPTS = 3;

const clone = (p: Portfolio) => JSON.parse(JSON.stringify(p)) as Portfolio;

export type AutoDividendUpdate = {
  /** The portfolio to save. */
  next: Portfolio;
  /** Expected dividends this update books. */
  pending: Dividend[];
  /** Past unconfirmed auto dividends voided because tracking now starts later. */
  voided: Dividend[];
  notifications: AppNotification[];
};

/**
 * What a load should write for these announcements, or null when there is nothing new (so nothing is
 * saved). Expected dividends only start from the day tracking began: that date is set once, and
 * unconfirmed auto dividends for earlier book closures are voided. Never mutates `portfolio`.
 */
export function planAutoDividendUpdate(
  portfolio: Portfolio,
  announcements: PayoutAnnouncement[],
  now: string = new Date().toISOString(),
  asOf: string = today(),
  faceValueEvidence: FaceValueEvidenceMap = {},
): AutoDividendUpdate | null {
  const next = clone(portfolio);
  const tracking = startDividendTracking(next, asOf);
  let pending: Dividend[], notifications: AppNotification[];
  try {
    pending = pendingAutoDividends(next, announcements, asOf, faceValueEvidence);
    notifications = [
      ...dividendNotifications(pending, now),
      ...announcementNotifications(next, announcements, asOf, now, faceValueEvidence),
    ];
  } catch {
    return null;
  }
  if (!notifications.length && !tracking.set && !tracking.voided.length) return null;
  if (pending.length) next.dividends = [...(next.dividends ?? []), ...pending];
  addNotifications(next, notifications);
  return { next, pending, voided: tracking.voided, notifications };
}

export type SyncSave = (portfolio: Portfolio, revision: number) => Promise<{ conflict: true } | { revision: number }>;
export type SyncReload = () => Promise<{ portfolio: Portfolio; revision: number } | null>;

export type AutoDividendSyncResult = {
  status: 'nothing' | 'saved' | 'gave-up' | 'failed';
  /** The newest portfolio and revision known after the run (differs from the input after a save or a reload). */
  portfolio: Portfolio;
  revision: number;
  update?: AutoDividendUpdate;
  error?: string;
};

/**
 * Plans and saves the update. When the portfolio changed meanwhile (the save answers `conflict`) it asks
 * `reload` for the fresh copy and recomputes against that revision, at most `maxAttempts` times in all, so
 * a background save never silently loses data and never loops. Writes nothing when nothing is new.
 */
export async function syncAutoDividends(
  loaded: { portfolio: Portfolio; revision: number },
  announcements: PayoutAnnouncement[],
  io: { save: SyncSave; reload: SyncReload },
  options: { maxAttempts?: number; now?: () => string; asOf?: string; faceValues?: FaceValueEvidenceMap } = {},
): Promise<AutoDividendSyncResult> {
  const maxAttempts = options.maxAttempts ?? MAX_SYNC_ATTEMPTS;
  let current = loaded.portfolio,
    revision = loaded.revision;
  for (let tries = 0; tries < maxAttempts; tries++) {
    const update = planAutoDividendUpdate(current, announcements, (options.now ?? (() => new Date().toISOString()))(), options.asOf, options.faceValues);
    if (!update) return { status: 'nothing', portfolio: current, revision };
    try {
      validate(update.next);
      const saved = await io.save(update.next, revision);
      if ('conflict' in saved) {
        const fresh = await io.reload();
        if (!fresh?.portfolio) return { status: 'gave-up', portfolio: current, revision };
        current = fresh.portfolio;
        revision = fresh.revision;
        continue;
      }
      return { status: 'saved', portfolio: update.next, revision: saved.revision, update };
    } catch (e) {
      return { status: 'failed', portfolio: current, revision, error: String(e) };
    }
  }
  return { status: 'gave-up', portfolio: current, revision };
}
