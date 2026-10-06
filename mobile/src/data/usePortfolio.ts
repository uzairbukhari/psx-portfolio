import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { refreshImportQuotes } from '@shared/import-refresh.ts';
import type { QuotesResponse } from '@shared/api-types.ts';
import { notificationCounts } from '@shared/notification-actions.ts';
import { loadAccountView, savePortfolioView } from '@shared/portfolio-view.ts';
import { validate, type Portfolio } from '@shared/portfolio.ts';
import {
  ALL_PORTFOLIOS,
  dashboardPortfolio,
  type PortfolioAccount,
  type PortfolioTarget,
} from '@shared/portfolio-account.ts';
import { ConflictError } from '@shared/vault-client.ts';
import { useAuth } from '@/auth/AuthProvider';
import { useVault } from '@/vault/VaultProvider';
import { usePortfolioSelection } from './PortfolioSelection';
import { openPositions, priceTickers, safeHoldings, totals } from './derive';

type AccountView = { account: PortfolioAccount; revision: number };
export function usePortfolio(scopeId?: string) {
  const { api, state } = useAuth();
  const { session, publicData } = useVault();
  const selection = usePortfolioSelection();
  const selectedId = scopeId ?? selection.selectedId;
  const select = selection.select;
  const queryClient = useQueryClient();
  const email = state.status === 'signedIn' ? state.user.email : '';
  const key = ['portfolio-account', email];
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(email),
    queryFn: () => loadAccountView(session, publicData, true),
  });
  const data = query.data ?? null;
  const single = data?.account.portfolios.length === 1;
  const entry = data?.account.portfolios.find((p) => p.id === selectedId) ?? (single ? data!.account.portfolios[0] : undefined);
  const isAll = !entry && selectedId === ALL_PORTFOLIOS;
  const portfolio = useMemo(()=> data ? dashboardPortfolio(data.account, entry?.id ?? ALL_PORTFOLIOS) : null, [data, entry?.id]);
  const view = useMemo(() => {
    if (!portfolio) return null;
    const { held, error } = safeHoldings(portfolio);
    return { held, error, open: openPositions(held), totals: totals(held) };
  }, [portfolio]);

  async function refreshPrices(extra: string[] = [], destination?: string) {
    const tickers = [
      ...new Set(
        (data?.account.portfolios ?? []).filter((p)=>!destination || p.id===destination).flatMap((p) => [...priceTickers(p.portfolio, extra), ...extra]),
      ),
    ];
    if (tickers.length) {
      try { await refreshImportQuotes({start:()=>api.post<QuotesResponse>('/api/quotes',{tickers}),poll:(since)=>api.get<QuotesResponse>(`/api/quotes?tickers=${tickers.join(',')}&since=${encodeURIComponent(since??'')}`),cancelled:()=>!session.active}); }
      finally { if (session.active) await queryClient.fetchQuery({queryKey:key,queryFn:()=>loadAccountView(session,publicData,false),staleTime:0}); }
    }
  }

  /** Target is captured by this render; delayed callbacks never consult the newly selected portfolio. */
  async function save(
    next: Portfolio,
    options: { target?: PortfolioTarget; expectedRevision?: number } = {},
  ) {
    const target =
      options.target ??
      (entry ? { id: entry.id } : null);
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
  async function saveNotifications(notifications: NonNullable<Portfolio['notifications']>) {
    if (!isAll) return save({...portfolio!,notifications});
    const current = queryClient.getQueryData<AccountView>(key);
    if (!current) throw Error('Portfolios are not loaded yet.');
    const account = session.account;
    const next = {...account,portfolios:account.portfolios.map((part)=>part.locked ? part : {...part,portfolio:{...part.portfolio,notifications:notifications.filter((n)=>n.id.startsWith(part.id+'::')).map((n)=>({...n,id:n.id.slice(part.id.length+2),title:n.title.replace(part.name+' · ','')}))}})};
    await session.saveAccount(next,current.revision);
    await queryClient.invalidateQueries({queryKey:key});
  }
  return {
    saveNotifications,
    save,
    portfolio,
    account: data?.account ?? null,
    selectedId,
    select,
    portfolioName: single || isAll ? 'All' : entry?.name ?? 'All',
    isAll,
    locked: !!entry?.locked,
    targetId: entry?.id,
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
