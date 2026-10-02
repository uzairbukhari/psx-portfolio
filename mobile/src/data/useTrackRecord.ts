import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PriceHistoryBatchResponse } from '@shared/api-types.ts';
import { tradedTickers } from '@shared/performance.ts';
import { today } from '@shared/portfolio.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { buildTrackRecord, historyBatches, type TrackRecord } from './track-record';
import { usePortfolio } from './usePortfolio';

const HOUR = 3_600_000;

/**
 * Daily closes for every company in the ledger plus the KSE-100 (one batched read each, cached for an hour),
 * folded with the saved portfolio into the value-vs-money-in series, the money-weighted return and the benchmark.
 */
export function useTrackRecord(): { status: 'loading' | 'error' | 'ready' | 'empty'; record: TrackRecord | null; retry: () => void } {
  const { api } = useAuth();
  const email = useEmail();
  const p = usePortfolio();
  const portfolio = p.portfolio;
  const tickers = useMemo(() => (portfolio ? tradedTickers(portfolio) : []), [portfolio]);
  const key = tickers.join(',');
  const q = useQuery({
    queryKey: ['price-histories', email, key],
    enabled: Boolean(email) && tickers.length > 0,
    staleTime: HOUR,
    queryFn: async () => {
      const merged: Record<string, number[][]> = {};
      for (const batch of historyBatches(tickers)) {
        const res = await api.get<PriceHistoryBatchResponse>(`/api/price-history?tickers=${encodeURIComponent(batch.join(','))}`);
        for (const [t, h] of Object.entries(res.histories ?? {})) merged[t] = h.eod;
      }
      return merged;
    },
  });
  const totals = p.view?.totals;
  const record = useMemo(() => {
    if (!portfolio || !totals || !q.data) return null;
    const complete = totals.missingPrice.length === 0;
    return buildTrackRecord({ portfolio, histories: q.data, asOf: today(), currentValue: complete ? totals.value : null, missingPrice: totals.missingPrice });
  }, [portfolio, totals, q.data]);
  if (portfolio && tickers.length === 0) return { status: 'empty', record: null, retry: () => {} };
  if (record) return { status: 'ready', record, retry: () => void q.refetch() };
  if (q.isError) return { status: 'error', record: null, retry: () => void q.refetch() };
  return { status: 'loading', record: null, retry: () => void q.refetch() };
}
