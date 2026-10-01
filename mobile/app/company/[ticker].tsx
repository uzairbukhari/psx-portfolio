import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { PriceHistoryResponse } from '@shared/api-types.ts';
import { money, moneyShort } from '@shared/portfolio.ts';
import { parseEod, parseIntraday, rangeChange, sliceRange, type HistoryRange } from '@shared/price-history.ts';
import { useAuth } from '@/auth/AuthProvider';
import { activityEntries, formatPercent } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { ActivityRow } from '@/ui/ActivityRow';
import { LineChart } from '@/ui/LineChart';
import { Amount, Card, Muted, Notice, Screen, Stat, Title, styles } from '@/ui/kit';

const RANGES: { key: HistoryRange; label: string }[] = [
  { key: 'today', label: '1D' },
  { key: '7d', label: '1W' },
  { key: '1m', label: '1M' },
  { key: '1y', label: '1Y' },
];

export default function Company() {
  const { ticker: raw } = useLocalSearchParams<{ ticker: string }>();
  const ticker = String(raw ?? '').toUpperCase();
  const { api } = useAuth();
  const p = usePortfolio();
  const [range, setRange] = useState<HistoryRange>('1m');

  const holding = p.view?.held.find((h) => h.ticker === ticker);
  const entries = useMemo(() => (p.portfolio ? activityEntries(p.portfolio, ticker) : []), [p.portfolio, ticker]);

  const history = useQuery({
    queryKey: ['history', ticker],
    queryFn: () => api.get<PriceHistoryResponse>(`/api/price-history?ticker=${encodeURIComponent(ticker)}`),
  });
  const points = useMemo(() => {
    if (!history.data) return [];
    return sliceRange(parseEod(history.data.eod), parseIntraday(history.data.intraday), range);
  }, [history.data, range]);
  const change = rangeChange(points);

  return (
    <Screen edges={[]} onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Stack.Screen options={{ title: ticker }} />
      {p.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {!p.isLoading && !holding ? <Notice tone="error">{ticker} is not in your portfolio.</Notice> : null}
      {holding ? (
        <>
          <Title>{holding.name}</Title>
          <Muted>{holding.sector}</Muted>
          <Card>
            <View style={styles.row}>
              <Stat label="Shares">
                <Text style={styles.strong}>{new Intl.NumberFormat('en-PK').format(holding.shares)}</Text>
              </Stat>
              <Stat label="Average cost">
                <Text style={styles.strong}>{holding.average === null ? '—' : money(holding.average)}</Text>
              </Stat>
              <Stat label="Last price">
                <Text style={styles.strong}>{holding.quote ? money(holding.quote.price) : '—'}</Text>
              </Stat>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Stat label="Value">
                <Text style={styles.strong}>{holding.value === null ? '—' : moneyShort(holding.value)}</Text>
              </Stat>
              <Stat label="Unrealised gain">
                <Amount value={holding.gain} text={holding.gain === null ? '—' : moneyShort(holding.gain)} />
              </Stat>
              <Stat label="Realised">
                <Amount value={holding.realized} text={holding.realized === null ? '—' : moneyShort(holding.realized)} />
              </Stat>
            </View>
            {holding.quote ? <Muted>Price as of {holding.quote.date}{holding.quote.manual ? ' (entered by you)' : ''}.</Muted> : null}
          </Card>

          <Card>
            <View style={styles.row}>
              <Text style={styles.strong}>Price</Text>
              {change ? <Amount value={change.change} text={formatPercent(change.percent)} size={14} /> : null}
            </View>
            {history.isPending ? <ActivityIndicator color={colors.primary} style={{ height: 150 }} /> : null}
            {history.error ? <Notice tone="error">{history.error.message}</Notice> : null}
            {history.data && points.length < 2 ? <Muted>Not enough price history for this range.</Muted> : null}
            {points.length >= 2 ? <LineChart points={points} /> : null}
            <View style={[styles.row, { justifyContent: 'center' }]}>
              {RANGES.map((r) => (
                <Pressable
                  key={r.key}
                  onPress={() => setRange(r.key)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: 8,
                    backgroundColor: range === r.key ? 'rgba(59,130,246,0.2)' : 'transparent',
                  }}
                >
                  <Text style={{ color: range === r.key ? colors.primary : colors.muted, fontWeight: '600' }}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
          </Card>

          <Title>History</Title>
          {entries.length === 0 ? <Muted>No trades or dividends recorded for {ticker}.</Muted> : null}
          <Card style={{ paddingVertical: 4 }}>
            {entries.map((e, i) => (
              <View key={e.id} style={i ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}>
                <ActivityRow entry={e} showTicker={false} />
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
