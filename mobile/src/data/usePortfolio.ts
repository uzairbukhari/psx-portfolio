import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortfolioResponse, QuotesResponse } from '@shared/api-types.ts';
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

  return {
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
