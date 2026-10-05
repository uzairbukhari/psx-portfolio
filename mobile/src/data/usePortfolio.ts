import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QuotesResponse } from '@shared/api-types.ts';
import { notificationCounts } from '@shared/notification-actions.ts';
import { loadAccountView, savePortfolioView } from '@shared/portfolio-view.ts';
import { validate, type Portfolio } from '@shared/portfolio.ts';
import {
  ALL_PORTFOLIOS,
  type PortfolioAccount,
  type PortfolioTarget,
} from '@shared/portfolio-account.ts';
import { ConflictError } from '@shared/vault-client.ts';
import { useAuth } from '@/auth/AuthProvider';
import { useVault } from '@/vault/VaultProvider';
import { usePortfolioSelection } from './PortfolioSelection';
import { openPositions, priceTickers, safeHoldings, totals } from './derive';

type AccountView = { account: PortfolioAccount; revision: number };
export function usePortfolio() {
  const { api, state } = useAuth();
  const { session, publicData } = useVault();
  const { selectedId, select } = usePortfolioSelection();
  const queryClient = useQueryClient();
  const email = state.status === 'signedIn' ? state.user.email : '';
  const key = ['portfolio-account', email];
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(email),
    queryFn: () => loadAccountView(session, publicData, true),
  });
  const data = query.data ?? null;
  const entry = data?.account.portfolios.find((p) => p.id === selectedId);
  const portfolio = entry?.portfolio ?? null;
  const view = useMemo(() => {
    if (!portfolio) return null;
    const { held, error } = safeHoldings(portfolio);
    return { held, error, open: openPositions(held), totals: totals(held) };
  }, [portfolio]);

  async function refreshPrices(extra: string[] = []) {
    const tickers = [
      ...new Set(
        (data?.account.portfolios ?? []).flatMap((p) =>
          priceTickers(p.portfolio, extra),
        ),
      ),
    ];
    if (tickers.length)
      await api.post<QuotesResponse>('/api/quotes', { tickers });
    await queryClient.invalidateQueries({ queryKey: key });
  }

  /** Target is captured by this render; delayed callbacks never consult the newly selected portfolio. */
  async function save(
    next: Portfolio,
    options: { target?: PortfolioTarget; expectedRevision?: number } = {},
  ) {
    const target =
      options.target ??
      (selectedId !== ALL_PORTFOLIOS ? { id: selectedId } : null);
    if (!target) throw new Error('Choose a portfolio before saving.');
    const current = queryClient.getQueryData<AccountView>(key) ?? data;
    if (!current) throw new Error('Portfolios are not loaded yet.');
    validate(next);
    const revision = options.expectedRevision ?? current.revision;
    await queryClient.cancelQueries({ queryKey: key });
    try {
      const saved = await savePortfolioView(
        session,
        publicData,
        next,
        revision,
        [],
        target,
      );
      queryClient.setQueryData<AccountView>(key, {
        account: {
          ...current.account,
          portfolios: session.account.portfolios.map((p) =>
            p.id === target.id
              ? { ...p, portfolio: next }
              : (current.account.portfolios.find((old) => old.id === p.id) ??
                p),
          ),
        },
        revision: saved.revision,
      });
      return saved.revision;
    } catch (e) {
      if (e instanceof ConflictError) {
        await queryClient.invalidateQueries({ queryKey: key });
        throw new Error(
          'Your account changed on another device. It has been reloaded. Rebuild the import preview or check Activity before trying again.',
        );
      }
      throw e;
    }
  }
  return {
    save,
    portfolio,
    account: data?.account ?? null,
    selectedId,
    select,
    portfolioName: entry?.name ?? 'All portfolios',
    isAll: selectedId === ALL_PORTFOLIOS,
    revision: data?.revision ?? 0,
    view,
    isLoading: query.isPending && !data,
    isRefetching: query.isRefetching,
    error: query.error,
    offline: session.offline || (Boolean(query.error) && Boolean(data)),
    savedAt: query.dataUpdatedAt || null,
    refetch: query.refetch,
    refreshPrices,
  };
}

export function useUnreadAlerts(): number {
  const p = usePortfolio();
  return useMemo(
    () =>
      p.account
        ? p.account.portfolios.reduce(
            (n, entry) =>
              n +
              notificationCounts(entry.portfolio.notifications ?? []).unread,
            0,
          )
        : 0,
    [p.account],
  );
}
