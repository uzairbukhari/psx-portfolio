import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { IndexPoint, IndexSummary, MarketState } from '@shared/psx-market.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import { signedPercent } from '@/data/format';
import { MARKET_POLL_MS, shouldPollMarket } from '@/data/market-hours';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { LineChart } from './LineChart';
import { Icon } from './Icon';
import { Card, Muted, StatusChip, useKitStyles } from './kit';

type Summary = { index: IndexSummary | null; series: IndexPoint[]; market: MarketState };
type Response = { summary?: Summary; fetchedAt?: string | null };

const number = (n: number) => n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * KSE-100 snapshot from the shared market cache. It loads when its screen is focused (stale data only) and
 * refreshes every minute only while the screen is focused and the PSX session is open; no requests otherwise.
 */
export function MarketPulse() {
  const styles = useKitStyles();
  const { colors } = useTheme();
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
  const tone = up ? colors.gain : colors.loss;
  return (
    <Card
      accessibilityLabel={`${index.name} ${number(index.close)}, ${signedAmountLabel(index.change, number)} points, ${signedPercentLabel(index.changePercent)}. Market ${summary.market.label.toLowerCase()}${summary.market.estimated ? ', estimated' : ''}, delayed prices${updated ? `, updated ${updated} Pakistan time` : ''}.`}
    >
      <Text style={styles.sectionLabel}>Market</Text>
      <View style={styles.row}>
        <View style={{ flexShrink: 1 }}>
          <Muted>{index.name}</Muted>
          <Text style={{ color: colors.ink, ...type.title, fontVariant: ['tabular-nums'] }}>{number(index.close)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name={up ? 'arrowUp' : 'arrowDown'} size={14} color={tone} strokeWidth={2.4} />
            <Text style={{ color: tone, ...type.number }}>
              {up ? '+' : '−'}
              {number(Math.abs(index.change))}
            </Text>
          </View>
          <Text style={{ color: tone, ...type.caption, fontVariant: ['tabular-nums'] }}>{signedPercent(index.changePercent)}</Text>
        </View>
      </View>
      {points.length > 1 ? <LineChart points={points} height={70} label={`${index.name} today`} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <StatusChip tone="neutral" text={`Market ${summary.market.label.toLowerCase()}${summary.market.estimated ? ' (estimated)' : ''}`} />
        <StatusChip tone="neutral" text="Delayed" icon="info" />
      </View>
      {updated ? <Muted>Updated {updated} PKT</Muted> : null}
    </Card>
  );
}
