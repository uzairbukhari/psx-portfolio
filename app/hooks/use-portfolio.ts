'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pendingAutoDividends,
  startDividendTracking,
  today,
  validate,
  type AppNotification,
  type Dividend,
  type Portfolio,
} from '@/lib/portfolio';
import {
  addNotifications,
  announcementNotifications,
  dividendNotifications,
} from '@/lib/notifications';
import type { PayoutAnnouncement } from '@/lib/psx-payouts';

type ApiResponse = {
  error?: string;
  portfolio: Portfolio;
  revision: number;
  announcements?: PayoutAnnouncement[];
};

/** Thrown when the stored portfolio changed since it was loaded (HTTP 409). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export const clonePortfolio = (p: Portfolio): Portfolio =>
  JSON.parse(JSON.stringify(p));

export type LoadStatus = 'loading' | 'ready' | 'error';
export type AutoDividendResult = { message: string; error?: boolean } | null;

async function fetchLatest(): Promise<ApiResponse> {
  const r = await fetch('/api/portfolio');
  const d = (await r.json()) as ApiResponse;
  if (!r.ok) throw Error(d.error);
  return d;
}

/** The single PUT path. Resolves with the new revision, or throws `ConflictError` on 409. */
async function persist(next: Portfolio, baseRevision: number) {
  const r = await fetch('/api/portfolio', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portfolio: next, revision: baseRevision }),
  });
  const d = (await r.json()) as { error?: string; revision: number };
  if (r.status === 409)
    throw new ConflictError(
      d.error ?? 'Your portfolio changed elsewhere. Reload the latest data.',
    );
  if (!r.ok) throw Error(d.error);
  return d.revision;
}

/**
 * Owns the loaded portfolio and its revision. Every write goes through `persist`, the one
 * PUT path; `save`, price refresh and the automatic dividend recorder all use it.
 */
export function usePortfolio(
  enabled: boolean,
  onNotice?: (notice: { message: string; error?: boolean }) => void,
) {
  const [p, setP] = useState<Portfolio | null>(null);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const noticeRef = useRef(onNotice);
  useEffect(() => {
    noticeRef.current = onNotice;
  });

  const adopt = useCallback((portfolio: Portfolio, revision: number) => {
    revisionRef.current = revision;
    setP(portfolio);
  }, []);

  /** Validates and saves `next`, then adopts it as the current portfolio. Does not show messages. */
  const save = useCallback(
    async (next: Portfolio) => {
      if (savingRef.current)
        throw Error('Wait for the current save to finish.');
      validate(next);
      savingRef.current = true;
      setSaving(true);
      try {
        const revision = await persist(next, revisionRef.current);
        revisionRef.current = revision;
        setP(next);
        return revision;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [],
  );

  /**
   * Records cash dividends PSX announced for held companies (as expected, unconfirmed
   * dividends) and posts payout news, in one revisioned save. If the portfolio changed
   * meanwhile (409), it reloads the fresh copy and recomputes against that revision
   * instead of giving up, so a background save never silently loses the update.
   */
  const recordAutoDividends = useCallback(
    async (
      loaded: Portfolio,
      loadedRevision: number,
      announcements: PayoutAnnouncement[],
    ): Promise<AutoDividendResult> => {
      let current = loaded,
        currentRevision = loadedRevision;
      for (let tries = 0; tries < 3; tries++) {
        let pending: Dividend[], news: AppNotification[];
        const now = new Date().toISOString();
        // Expected dividends only start from the day tracking began: set that date once and
        // void unconfirmed auto dividends for earlier book closures.
        const next = clonePortfolio(current);
        const tracking = startDividendTracking(next);
        try {
          pending = pendingAutoDividends(next, announcements);
          news = [
            ...dividendNotifications(pending, now),
            ...announcementNotifications(next, announcements, today(), now),
          ];
        } catch {
          return null;
        }
        if (!news.length && !tracking.set && !tracking.voided.length)
          return null;
        if (pending.length)
          next.dividends = [...(next.dividends ?? []), ...pending];
        addNotifications(next, news);
        try {
          validate(next);
          const revision = await persist(next, currentRevision);
          adopt(next, revision);
          if (tracking.voided.length)
            return {
              message: `${tracking.voided.length} past expected dividend${tracking.voided.length === 1 ? '' : 's'} voided: expected dividends now start from ${next.dividendTrackingFrom}.`,
            };
          if (pending.length)
            return {
              message: `${pending.length} expected dividend${pending.length === 1 ? '' : 's'} added from PSX announcements: ${pending.map((d) => d.ticker).join(', ')}. Mark them received once paid.`,
            };
          return null;
        } catch (e) {
          if (e instanceof ConflictError) {
            try {
              const d = await fetchLatest();
              if (!d.portfolio) return null;
              current = d.portfolio;
              currentRevision = d.revision;
              adopt(current, currentRevision);
              continue;
            } catch {
              return null;
            }
          }
          return {
            message: 'Could not record PSX dividends: ' + String(e),
            error: true,
          };
        }
      }
      return null;
    },
    [adopt],
  );

  /** Loads the portfolio, then records PSX dividends; any resulting notice goes to `onNotice`. */
  const load = useCallback(async () => {
    try {
      const d = await fetchLatest();
      adopt(d.portfolio, d.revision);
      setStatus('ready');
      setLoadError('');
      const notice = await recordAutoDividends(
        d.portfolio,
        d.revision,
        d.announcements ?? [],
      );
      if (notice) noticeRef.current?.(notice);
    } catch (e) {
      setLoadError(String(e));
      setStatus((s) => (s === 'ready' ? s : 'error'));
      throw e;
    }
  }, [adopt, recordAutoDividends]);

  /** Re-reads the latest saved portfolio (conflict recovery). Drafts live in the dialogs and are untouched. */
  const reload = useCallback(async () => {
    const d = await fetchLatest();
    adopt(d.portfolio, d.revision);
  }, [adopt]);

  /** Retries a failed first load from the error screen. */
  const retry = useCallback(async () => {
    setStatus('loading');
    await load().catch(() => {});
  }, [load]);

  useEffect(() => {
    // Deferred a tick so the load's state updates never run synchronously inside the effect.
    if (enabled) void Promise.resolve().then(load).catch(() => {});
  }, [enabled, load]);

  return {
    p,
    status,
    loadError,
    saving,
    load,
    retry,
    reload,
    save,
    revision: () => revisionRef.current,
  };
}
