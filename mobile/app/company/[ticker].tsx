import { useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { PriceHistoryResponse } from '@shared/api-types.ts';
import { money, moneyShort } from '@shared/portfolio.ts';
import { parseEod, parseIntraday, rangeChange, sliceRange, type HistoryRange } from '@shared/price-history.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { activityEntries, companyDividends, formatPercent } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { ActivityRow } from '@/ui/ActivityRow';
import { LineChart } from '@/ui/LineChart';
import { Amount, Avatar, Badge, Button, Card, Chip, EmptyState, ListRow, Loading, Muted, Notice, Screen, SectionLabel, Stat, styles } from '@/ui/kit';

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
  const email = useEmail();
  const p = usePortfolio();
  const [range, setRange] = useState<HistoryRange>('1m');

  const holding = p.view?.held.find((h) => h.ticker === ticker);
  const dividends = useMemo(() => (p.portfolio ? companyDividends(p.portfolio, ticker) : []), [p.portfolio, ticker]);
  const entries = useMemo(() => (p.portfolio ? activityEntries(p.portfolio, ticker) : []), [p.portfolio, ticker]);

  const history = useQuery({
    queryKey: ['history', email, ticker],
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
      {p.isLoading ? <Loading /> : null}
      {!p.isLoading && !holding ? <Notice tone="error">{ticker} is not in your portfolio.</Notice> : null}
      {holding ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar ticker={ticker} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: '700' }} numberOfLines={2}>{holding.name}</Text>
              <Muted>{ticker} · {holding.sector}</Muted>
            </View>
          </View>
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
                <Chip key={r.key} label={r.label} selected={range === r.key} onPress={() => setRange(r.key)} />
              ))}
            </View>
          </Card>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Add transaction" icon="plus" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/transaction', params: { ticker } })} />
            <Button label="Set price" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/quote', params: { ticker } })} />
          </View>
          {dividends.length ? (
            <>
              <SectionLabel>Dividends</SectionLabel>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {dividends.map((d, i) => (
                  <View key={d.id} style={i < dividends.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.border } : undefined}>
                    <ListRow
                      title={`${d.status === 'expected' ? 'Expected' : 'Received'}${d.perShare ? ` · ${money(d.perShare)}/share` : ''}`}
                      subtitle={
                        d.status === 'expected'
                          ? `Book closure ${d.date} · not received yet`
                          : `${d.paymentDate ? `Paid ${d.paymentDate}` : `Dated ${d.date}`}${d.tax !== null ? ` · tax ${d.taxIsActual ? 'withheld' : 'estimated'} ${money(d.tax)}` : ''}`
                      }
                      right={
                        <View style={{ alignItems: 'flex-end', gap: 4 }}>
                          <Text style={{ color: d.status === 'expected' ? colors.muted : colors.success, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
                            {d.status === 'expected' ? '≈ ' : '+'}
                            {money(d.gross)}
                          </Text>
                          {d.status === 'expected' ? <Badge text="Expected" tone="warn" /> : <Badge text="Received" tone="success" />}
                        </View>
                      }
                      last
                    />
                    {d.status === 'expected' ? (
                      <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                        <Button
                          label="Mark received"
                          variant="secondary"
                          icon="check"
                          onPress={() => router.push({ pathname: '/received', params: { id: d.id } })}
                        />
                      </View>
                    ) : null}
                  </View>
                ))}
              </Card>
              <Muted>Expected dividends are planning figures until you mark them received.</Muted>
            </>
          ) : null}
          <SectionLabel>History</SectionLabel>
          {entries.length === 0 ? (
            <EmptyState icon="activity" title={`No entries for ${ticker}`} body="Trades and dividends for this company will be listed here." />
          ) : (
            <>
              {entries.some((e) => e.editable) ? <Muted>Tap an entry to correct or void it.</Muted> : null}
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {entries.map((e, i) => (
                  <ActivityRow
                    key={e.id}
                    entry={e}
                    showTicker={false}
                    last={i === entries.length - 1}
                    onPress={e.editable ? () => router.push({ pathname: '/transaction', params: { id: e.id } }) : undefined}
                  />
                ))}
              </Card>
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
