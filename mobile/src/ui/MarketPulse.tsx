import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { IndexPoint, IndexSummary, MarketState } from '@shared/psx-market.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import { formatPercent } from '@/data/derive';
import { MARKET_POLL_MS, shouldPollMarket } from '@/data/market-hours';
import { colors } from '@/theme/tokens';
import { LineChart } from './LineChart';
import { Card, Muted, styles } from './kit';

type Summary = { index: IndexSummary | null; series: IndexPoint[]; market: MarketState };
type Response = { summary?: Summary; fetchedAt?: string | null };

const number = (n: number) => n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * KSE-100 snapshot from the shared market cache. It loads when its screen is focused (stale data only) and
 * refreshes every minute only while the screen is focused and the PSX session is open; no requests otherwise.
 */
export function MarketPulse() {
  const { api } = useAuth();
  const email = useEmail();
  const focused = useIsFocused();
  const q = useQuery({
    queryKey: ['market-summary', email],
    queryFn: () => api.get<Response>('/api/market-summary'),
    enabled: focused,
    staleTime: MARKET_POLL_MS,
  });
  const refetch = q.refetch;
  useEffect(() => {
    if (!focused) return;
    const timer = setInterval(() => {
      if (shouldPollMarket(true)) void refetch();
    }, MARKET_POLL_MS);
    return () => clearInterval(timer);
  }, [focused, refetch]);
  const summary = q.data?.summary;
  const index = summary?.index;
  // The market card is a nicety: stay silent rather than adding an error to the Holdings screen.
  if (!summary || !index) return null;
  const up = index.change >= 0;
  const points = summary.series.map((p) => [p.time, p.value] as [number, number]);
  const updated = q.data?.fetchedAt
    ? new Date(q.data.fetchedAt).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <Card
      accessibilityLabel={`${index.name} ${number(index.close)}, ${signedAmountLabel(index.change, number)} points, ${signedPercentLabel(index.changePercent)}. Market ${summary.market.label.toLowerCase()}${summary.market.estimated ? ', estimated' : ''}, delayed prices${updated ? `, updated ${updated} Pakistan time` : ''}.`}
    >
      <View style={styles.row}>
        <View>
          <Muted>{index.name}</Muted>
          <Text style={{ color: colors.foreground, fontSize: 24, fontWeight: '700' }}>{number(index.close)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: up ? colors.success : colors.danger, fontWeight: '600' }}>
            {up ? '+' : ''}
            {number(index.change)}
          </Text>
          <Text style={{ color: up ? colors.success : colors.danger }}>{formatPercent(index.changePercent)}</Text>
        </View>
      </View>
      {points.length > 1 ? <LineChart points={points} height={70} label={`${index.name} today`} /> : null}
      <Muted>
        Market {summary.market.label.toLowerCase()}
        {summary.market.estimated ? ' (estimated)' : ''} · delayed prices{updated ? ` · updated ${updated} PKT` : ''}
      </Muted>
    </Card>
  );
}
