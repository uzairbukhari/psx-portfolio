import { useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortfolioResponse, QuotesResponse, SavePortfolioRequest, SavePortfolioResponse } from '@shared/api-types.ts';
import { notificationCounts } from '@shared/notification-actions.ts';
import { validate, type Portfolio } from '@shared/portfolio.ts';
import { ApiRequestError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { syncAnnouncementsOnLoad } from './auto-dividends';
import { openPositions, priceTickers, safeHoldings, totals } from './derive';
import { useCachedPortfolio, useCachedSavedAt } from './PortfolioCacheProvider';
import { writePortfolioCache } from './portfolio-cache';

export function usePortfolio() {
  const { api, state } = useAuth();
  const queryClient = useQueryClient();
  const email = state.status === 'signedIn' ? state.user.email : '';
  const cached = useCachedPortfolio();
  const cachedSavedAt = useCachedSavedAt();

  const query = useQuery({
    queryKey: ['portfolio', email],
    enabled: Boolean(email),
    queryFn: async () => {
      const loaded = await api.get<PortfolioResponse>('/api/portfolio');
      // Same as the web on load: book PSX announcements as expected dividends and alerts (saves only when
      // something is new), so the phone alone keeps them current.
      const data = await syncAnnouncementsOnLoad(api, loaded);
      writePortfolioCache(email, data);
      return data;
    },
  });

  const data = query.data ?? cached;
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
      const saved = await api.put<SavePortfolioResponse>('/api/portfolio', {
        portfolio: next,
        revision: current.revision,
      } satisfies SavePortfolioRequest);
      const updated: PortfolioResponse = { ...current, portfolio: next, revision: saved.revision };
      queryClient.setQueryData(['portfolio', email], updated);
      writePortfolioCache(email, updated);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 409) {
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
    offline: Boolean(query.error) && Boolean(data),
    /** When the data on screen was last fetched or saved (ms since epoch); null if unknown. */
    savedAt: query.dataUpdatedAt || cachedSavedAt,
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
  const cached = useCachedPortfolio();
  const live = useSyncExternalStore(
    (notify) => queryClient.getQueryCache().subscribe(notify),
    () => queryClient.getQueryData<PortfolioResponse>(['portfolio', email]),
  );
  const data = live ?? cached;
  return useMemo(() => (data ? notificationCounts(data.portfolio.notifications ?? []).unread : 0), [data]);
}
