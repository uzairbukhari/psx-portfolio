import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { IndexPoint, IndexSummary, MarketState } from '@shared/psx-market.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { formatPercent } from '@/data/derive';
import { colors } from '@/theme/tokens';
import { LineChart } from './LineChart';
import { Card, Muted, styles } from './kit';

type Summary = { index: IndexSummary | null; series: IndexPoint[]; market: MarketState };
type Response = { summary?: Summary; fetchedAt?: string | null };

const number = (n: number) => n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** KSE-100 snapshot from the shared market cache; refreshes every minute while on screen. */
export function MarketPulse() {
  const { api } = useAuth();
  const email = useEmail();
  const q = useQuery({
    queryKey: ['market-summary', email],
    queryFn: () => api.get<Response>('/api/market-summary'),
    refetchInterval: 60_000,
    refetchOnMount: 'always',
  });
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
    <Card>
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
      {points.length > 1 ? <LineChart points={points} height={70} /> : null}
      <Muted>
        Market {summary.market.label.toLowerCase()}
        {summary.market.estimated ? ' (estimated)' : ''} · delayed prices{updated ? ` · updated ${updated} PKT` : ''}
      </Muted>
    </Card>
  );
}
