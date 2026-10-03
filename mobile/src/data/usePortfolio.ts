import { useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortfolioResponse, QuotesResponse } from '@shared/api-types.ts';
import { notificationCounts } from '@shared/notification-actions.ts';
import { loadPortfolioView, savePortfolioView } from '@shared/portfolio-view.ts';
import { validate, type Portfolio } from '@shared/portfolio.ts';
import { ConflictError } from '@shared/vault-client.ts';
import { useAuth } from '@/auth/AuthProvider';
import { useVault } from '@/vault/VaultProvider';
import { syncAnnouncementsOnLoad } from './auto-dividends';
import { openPositions, priceTickers, safeHoldings, totals } from './derive';

export function usePortfolio() {
  const { api, state } = useAuth();
  const { session, publicData } = useVault();
  const queryClient = useQueryClient();
  const email = state.status === 'signedIn' ? state.user.email : '';

  const query = useQuery({
    queryKey: ['portfolio', email],
    enabled: Boolean(email),
    queryFn: async () => {
      // Decrypts on this phone and overlays public quotes, announcements and company names for the tickers held.
      const loaded = await loadPortfolioView(session, publicData);
      // Same as the web on load: book PSX announcements as expected dividends and alerts (saves only when
      // something is new), so the phone alone keeps them current.
      return syncAnnouncementsOnLoad(
        {
          save: async (portfolio, revision) => {
            try {
              return { revision: (await savePortfolioView(session, publicData, portfolio, revision)).revision };
            } catch (e) {
              if (e instanceof ConflictError) return { conflict: true as const };
              throw e;
            }
          },
          reload: async () => {
            const fresh = await loadPortfolioView(session, publicData);
            return { portfolio: fresh.portfolio, revision: fresh.revision };
          },
        },
        loaded,
      );
    },
  });

  const data = query.data ?? null;
  const view = useMemo(() => {
    if (!data) return null;
    const { held, error } = safeHoldings(data.portfolio);
    return { held, error, open: openPositions(held), totals: totals(held) };
  }, [data]);

  /**
   * Asks the server for fresh PSX prices (cached server-side), then reloads. Covers held and targeted
   * companies and the Monthly Picks shortlist, since the SIP plan needs a price for each; `extra` adds tickers.
   */
  async function refreshPrices(extra: string[] = []) {
    const tickers = data ? priceTickers(data.portfolio, extra) : [];
    if (tickers.length) await api.post<QuotesResponse>('/api/quotes', { tickers });
    await queryClient.invalidateQueries({ queryKey: ['portfolio', email] });
  }

  /**
   * Validates and saves a new version of the portfolio. The server rejects a stale revision
   * with 409 (edited elsewhere); then we reload and ask the user to retry. The revision is read from the
   * query cache at call time, so a save started later (an undo from a toast, after the screen that made the
   * change has closed) still uses the revision of the previous save.
   */
  async function save(next: Portfolio) {
    const current = queryClient.getQueryData<PortfolioResponse>(['portfolio', email]) ?? data;
    if (!current) throw new Error('Portfolio is not loaded yet.');
    validate(next);
    // A refetch that started before this save must not land afterwards and overwrite the new data.
    await queryClient.cancelQueries({ queryKey: ['portfolio', email] });
    try {
      // Validates, fills company details from the public directory, encrypts here and stores ciphertext only.
      const saved = await savePortfolioView(session, publicData, next, current.revision);
      const updated: PortfolioResponse = { ...current, portfolio: next, revision: saved.revision };
      queryClient.setQueryData(['portfolio', email], updated);
    } catch (e) {
      if (e instanceof ConflictError) {
        await queryClient.invalidateQueries({ queryKey: ['portfolio', email] });
        throw new Error('Your portfolio changed (on another device, or this save did not reach us). It has been reloaded. Check Activity before entering the change again.');
      }
      throw e;
    }
  }

  return {
    save,
    portfolio: data?.portfolio ?? null,
    revision: data?.revision ?? 0,
    view,
    isLoading: query.isPending && !data,
    isRefetching: query.isRefetching,
    error: query.error,
    offline: session.offline || (Boolean(query.error) && Boolean(data)),
    /** When the data on screen was last fetched or saved (ms since epoch); null if unknown. */
    savedAt: query.dataUpdatedAt || null,
    refetch: query.refetch,
    refreshPrices,
  };
}

/**
 * Unread alert count for the bell badge. It watches the shared portfolio query's cache without being an
 * observer of it, so it can never fetch the query or change how the real observers fetch it.
 */
export function useUnreadAlerts(): number {
  const { state } = useAuth();
  const email = state.status === 'signedIn' ? state.user.email : '';
  const queryClient = useQueryClient();
  const live = useSyncExternalStore(
    (notify) => queryClient.getQueryCache().subscribe(notify),
    () => queryClient.getQueryData<PortfolioResponse>(['portfolio', email]),
  );
  const data = live ?? null;
  return useMemo(() => (data ? notificationCounts(data.portfolio.notifications ?? []).unread : 0), [data]);
}
