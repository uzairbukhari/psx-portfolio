import { useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { PriceHistoryResponse } from '@shared/api-types.ts';
import { money, moneyShort } from '@shared/portfolio.ts';
import { parseEod, parseIntraday, rangeChange, sliceRange, type HistoryRange } from '@shared/price-history.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { activityEntries, companyDividends } from '@/data/derive';
import { changeSummary, shortDate, signedMoney, signedPercent } from '@/data/format';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { ActivityRow } from '@/ui/ActivityRow';
import { LineChart } from '@/ui/LineChart';
import { Amount, Avatar, Button, Card, EmptyState, ListRow, Loading, Muted, Notice, Screen, Segmented, StatusChip, Stat, useKitStyles } from '@/ui/kit';

const RANGES: { key: HistoryRange; label: string; spoken: string }[] = [
  { key: 'today', label: '1D', spoken: 'One day' },
  { key: '7d', label: '1W', spoken: 'One week' },
  { key: '1m', label: '1M', spoken: 'One month' },
  { key: '1y', label: '1Y', spoken: 'One year' },
  { key: '3y', label: '3Y', spoken: 'Three years' },
  { key: '5y', label: '5Y', spoken: 'Five years' },
];
type Tab = 'ledger' | 'dividends';

export default function Company() {
  const { ticker: raw } = useLocalSearchParams<{ ticker: string }>();
  const ticker = String(raw ?? '').toUpperCase();
  const { api } = useAuth();
  const email = useEmail();
  const p = usePortfolio();
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [range, setRange] = useState<HistoryRange>('1m');
  const [tab, setTab] = useState<Tab>('ledger');

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
  const rangeSpoken = RANGES.find((r) => r.key === range)?.spoken.toLowerCase() ?? '';
  const summary = changeSummary(change, rangeSpoken);
  const expectedCount = dividends.filter((d) => d.status === 'expected').length;
  // plan()/holdings() hide a saved quote that predates the latest split; say so instead of just "no price".
  const hiddenQuote = holding && !holding.quote ? p.portfolio?.quotes[ticker] : undefined;

  return (
    <Screen edges={[]} onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Stack.Screen options={{ title: ticker }} />
      {p.isLoading ? <Loading cards={2} /> : null}
      {!p.isLoading && !holding ? <Notice tone="error">{ticker} is not in your portfolio.</Notice> : null}
      {p.offline ? <Notice tone="offline">Offline · showing your saved copy.</Notice> : null}
      {holding ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar ticker={ticker} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, ...type.title }} numberOfLines={2} accessibilityRole="header">{holding.name}</Text>
              <Muted>{ticker} · {holding.sector}</Muted>
            </View>
          </View>
          <Card>
            <Text style={styles.sectionLabel}>Last price</Text>
            {holding.quote ? (
              <>
                <Text style={{ color: colors.ink, ...type.display }}>{money(holding.quote.price)}</Text>
                <Muted>
                  Price as of {shortDate(holding.quote.date)}{holding.quote.manual ? ' · entered by you, kept until PSX publishes a later day' : ''}.
                </Muted>
              </>
            ) : (
              <>
                <Text style={styles.strong}>No price yet</Text>
                <Muted>{hiddenQuote ? `The saved price is from ${shortDate(hiddenQuote.date)}, before the latest stock split, so it is not used. ` : ''}Add a price to value this holding.</Muted>
                <Button label="Set price" variant="tonal" onPress={() => router.push({ pathname: '/quote', params: { ticker } })} />
              </>
            )}
          </Card>

          <Card>
            <Text style={styles.sectionLabel}>Your position</Text>
            {holding.shares === 0 ? <StatusChip tone="neutral" text="Sold out · history only" /> : null}
            <View style={styles.row}>
              <Stat label="Shares">
                <Text style={styles.number}>{new Intl.NumberFormat('en-PK').format(holding.shares)}</Text>
              </Stat>
              <Stat label="Average cost">
                <Text style={styles.number}>{holding.average === null ? '—' : money(holding.average)}</Text>
              </Stat>
              <Stat label="Cost">
                <Text style={styles.number}>{holding.cost === null ? 'Not yet known' : moneyShort(holding.cost)}</Text>
              </Stat>
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <Stat label="Value">
                <Text style={styles.number}>{holding.value === null ? '—' : moneyShort(holding.value)}</Text>
              </Stat>
              <Stat label="Unrealised gain">
                {holding.gain === null ? <Text style={styles.muted}>—</Text> : <Amount value={holding.gain} text={`${signedMoney(holding.gain)}${holding.cost ? ` (${signedPercent((holding.gain / holding.cost) * 100)})` : ''}`} label="Unrealised" />}
              </Stat>
              <Stat label="Realised gain">
                {holding.realized === null ? <Text style={styles.muted}>—</Text> : <Amount value={holding.realized} label="Realised" />}
              </Stat>
            </View>
            {holding.cost === null && holding.shares > 0 ? <Muted>Cost is not known. Edit the opening entry to add its cost.</Muted> : null}
          </Card>

          <Card>
            <Text style={styles.sectionLabel}>Price</Text>
            {summary ? <Text style={styles.strong}>{summary}</Text> : null}
            {history.isPending ? <ActivityIndicator color={colors.primary} style={{ height: 150 }} /> : null}
            {history.error ? <Notice tone="error" action={{ label: 'Try again', onPress: () => void history.refetch() }}>{history.error.message}</Notice> : null}
            {history.data && points.length < 2 ? <Muted>Not enough price history for this range.</Muted> : null}
            {points.length >= 2 ? <LineChart points={points} label={`${ticker} price, ${rangeSpoken}`} /> : null}
            <Segmented label="Price range" value={range} onChange={setRange} options={RANGES.map((r) => ({ key: r.key, label: r.label, spoken: `${r.spoken} price range` }))} />
          </Card>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Add" icon="plus" style={{ flex: 1 }} disabled={p.offline} accessibilityHint={`Records a transaction for ${ticker}`} onPress={() => router.push({ pathname: '/transaction', params: { ticker } })} />
            <Button label="Set price" variant="outline" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/quote', params: { ticker } })} />
          </View>

          <Segmented
            label={`${ticker} ledger and dividends`}
            value={tab}
            onChange={setTab}
            options={[{ key: 'ledger', label: 'Ledger' }, { key: 'dividends', label: expectedCount ? `Dividends · ${expectedCount} expected` : 'Dividends' }]}
          />

          {tab === 'dividends' ? (
            dividends.length === 0 ? (
              <EmptyState icon="inbox" title="No dividends yet" body="PSX payout announcements for this company show up here as expected, and become income once you mark them received." />
            ) : (
              <>
                <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
                  {dividends.map((d, i) => (
                    <View key={d.id} style={i < dividends.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.line } : undefined}>
                      <ListRow
                        title={`${d.status === 'expected' ? 'Expected' : 'Received'}${d.perShare ? ` · ${money(d.perShare)}/share` : ''}`}
                        wrapTitle
                        subtitle={
                          d.status === 'expected'
                            ? `Book closure ${d.date} · not received yet`
                            : `${d.paymentDate ? `Paid ${d.paymentDate}` : `Dated ${d.date}`}${d.tax !== null ? ` · tax ${d.taxIsActual ? 'withheld' : 'estimated'} ${money(d.tax)}${d.net !== null ? ` · net ${money(d.net)}` : ''}` : ''}`
                        }
                        accessibilityLabel={`${d.status === 'expected' ? 'Expected' : 'Received'} dividend${d.perShare ? `, ${money(d.perShare)} per share` : ''}, ${d.status === 'expected' ? `book closure ${d.date}, not received yet, about ${money(d.gross)}` : `${d.paymentDate ? `paid ${d.paymentDate}` : `dated ${d.date}`}, ${money(d.gross)} gross`}`}
                        right={
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Text style={[styles.number, { color: d.status === 'expected' ? colors.muted : colors.gain }]}>
                              {d.status === 'expected' ? '≈ ' : '+'}
                              {money(d.gross)}
                            </Text>
                            {d.status === 'expected' ? <StatusChip text="Expected" tone="warn" icon="calendar" /> : <StatusChip text="Received" tone="success" />}
                          </View>
                        }
                        last
                      />
                      {d.status === 'expected' ? (
                        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                          <Button label="Mark received" variant="tonal" icon="check" onPress={() => router.push({ pathname: '/received', params: { id: d.id } })} />
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
                <Muted>Expected dividends are planning figures until you mark them received.</Muted>
              </>
            )
          ) : entries.length === 0 ? (
            <EmptyState icon="activity" title={`No entries for ${ticker}`} body="Trades and dividends for this company will be listed here." />
          ) : (
            <>
              {entries.some((e) => e.editable) ? <Muted>Tap an entry to correct or void it.</Muted> : null}
              <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
                {entries.map((e, i) => (
                  <ActivityRow
                    key={e.id}
                    entry={e}
                    showTicker={false}
                    last={i === entries.length - 1}
                    onPress={e.editable ? () => router.push({ pathname: '/transaction', params: { id: e.id } }) : undefined}
                  />
                ))}
              </View>
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
