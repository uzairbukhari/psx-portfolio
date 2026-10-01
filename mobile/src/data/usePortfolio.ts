import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortfolioResponse, QuotesResponse, SavePortfolioRequest, SavePortfolioResponse } from '@shared/api-types.ts';
import { validate, type Portfolio } from '@shared/portfolio.ts';
import { ApiRequestError } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { openPositions, safeHoldings, totals } from './derive';
import { readPortfolioCache, writePortfolioCache } from './portfolio-cache';

export function usePortfolio() {
  const { api, state } = useAuth();
  const queryClient = useQueryClient();
  const email = state.status === 'signedIn' ? state.user.email : '';
  const [cached, setCached] = useState<PortfolioResponse | null>(null);

  useEffect(() => {
    let live = true;
    if (email) void readPortfolioCache(email).then((c) => live && setCached(c));
    return () => {
      live = false;
    };
  }, [email]);

  const query = useQuery({
    queryKey: ['portfolio', email],
    enabled: Boolean(email),
    queryFn: async () => {
      const data = await api.get<PortfolioResponse>('/api/portfolio');
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

  /** Asks the server for fresh PSX prices for open positions (cached server-side), then reloads. */
  async function refreshPrices() {
    const tickers = view?.open.map((h) => h.ticker) ?? [];
    if (tickers.length) await api.post<QuotesResponse>('/api/quotes', { tickers });
    await queryClient.invalidateQueries({ queryKey: ['portfolio', email] });
  }

  /**
   * Validates and saves a new version of the portfolio. The server rejects a stale revision
   * with 409 (edited elsewhere); then we reload and ask the user to retry.
   */
  async function save(next: Portfolio) {
    if (!data) throw new Error('Portfolio is not loaded yet.');
    validate(next);
    // A refetch that started before this save must not land afterwards and overwrite the new data.
    await queryClient.cancelQueries({ queryKey: ['portfolio', email] });
    try {
      const saved = await api.put<SavePortfolioResponse>('/api/portfolio', {
        portfolio: next,
        revision: data.revision,
      } satisfies SavePortfolioRequest);
      const updated: PortfolioResponse = { ...data, portfolio: next, revision: saved.revision };
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
    refetch: query.refetch,
    refreshPrices,
  };
}
