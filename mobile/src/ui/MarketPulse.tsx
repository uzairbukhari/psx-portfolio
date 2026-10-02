import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { IndexPoint, IndexSummary, MarketState } from '@shared/psx-market.ts';
import type { MarketBreadthView, MarketIndexView } from '@shared/api-types.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import { signedPercent } from '@/data/format';
import { liveRows, shouldStream } from '@/data/live-market';
import { MARKET_POLL_MS, marketOpen, shouldPollMarket } from '@/data/market-hours';
import { useLiveMarket } from '@/data/useLiveMarket';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { LineChart } from './LineChart';
import { Icon } from './Icon';
import { Card, Muted, StatusChip, useKitStyles } from './kit';

type Summary = { index: IndexSummary | null; indices?: MarketIndexView[]; breadth?: MarketBreadthView | null; series: IndexPoint[]; market: MarketState; live?: { available: boolean } };
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
  // Live company ticks over the SSE stream, only while focused and during market hours (re-checked every 30 s).
  const [open, setOpen] = useState(() => marketOpen());
  useEffect(() => {
    if (!focused) return;
    setOpen(marketOpen());
    const timer = setInterval(() => setOpen(marketOpen()), 30_000);
    return () => clearInterval(timer);
  }, [focused]);
  const { live, status } = useLiveMarket(shouldStream({ focused, appActive: true, marketOpen: open, available: summary?.live?.available === true }));
  const rows = status === 'live' ? liveRows(live) : [];
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
      accessibilityLabel={`${index.name} ${number(index.close)}, ${signedAmountLabel(index.change, number)} points, ${signedPercentLabel(index.changePercent)}. Market ${summary.market.label.toLowerCase()}${summary.market.estimated ? ', estimated' : ''}, delayed prices${updated ? `, updated ${updated} Pakistan time` : ''}.${rows.length ? ` Live prices: ${rows.map((r) => `${r.ticker} ${number(r.price)}${r.changePercent === null ? '' : `, ${signedPercentLabel(r.changePercent)}`}`).join('; ')}.` : ''}`}
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
      {summary.indices && summary.indices.length > 1 ? (
        <View style={{ gap: 6 }} accessibilityLabel="Other indices">
          {summary.indices.filter((entry) => entry.code !== 'KSE100').map((entry) => {
            const entryUp = entry.change >= 0;
            return (
              <View key={entry.code} style={styles.row} accessible accessibilityLabel={`${entry.label} ${number(entry.close)}, ${signedPercentLabel(entry.changePercent)}, ${entry.meta.freshness}. ${entry.meta.reason}`}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.text}>{entry.label}</Text>
                  <Muted>{entry.meta.freshness === 'fresh' ? 'Fresh' : entry.meta.freshness === 'delayed' ? 'Delayed' : 'Stale'} · {entry.asOf}</Muted>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.ink, ...type.number, fontVariant: ['tabular-nums'] }}>{number(entry.close)}</Text>
                  <Text style={{ color: entryUp ? colors.gain : colors.loss, ...type.caption, fontVariant: ['tabular-nums'] }}>{signedPercent(entry.changePercent)}</Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      {summary.breadth && summary.breadth.covered > 0 ? (
        <Muted>
          {summary.breadth.advances} up · {summary.breadth.declines} down · {summary.breadth.unchanged} unchanged across {summary.breadth.covered} securities in the {summary.breadth.source}.
        </Muted>
      ) : null}
      {points.length > 1 ? <LineChart points={points} height={70} label={`${index.name} today`} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <StatusChip tone="neutral" text={`Market ${summary.market.label.toLowerCase()}${summary.market.estimated ? ' (estimated)' : ''}`} />
        <StatusChip tone="neutral" text="Index delayed" icon="info" />
        {status === 'live'
          ? rows.some((r) => r.sourceTimestamp)
            ? <StatusChip tone="primary" text="Live prices" icon="refresh" />
            : <StatusChip tone="neutral" text="Connected, awaiting timed quotes" icon="info" />
          : null}
      </View>
      {rows.length ? (
        <View style={{ gap: 4 }}>
          {rows.map((r) => (
            <View key={r.ticker} style={styles.row}>
              <Text style={styles.text}>{r.ticker}</Text>
              <Text style={{ color: r.changePercent === null ? colors.ink : r.changePercent >= 0 ? colors.gain : colors.loss, ...type.number, fontVariant: ['tabular-nums'] }}>
                {number(r.price)}
                {r.changePercent === null ? '' : `  ${signedPercent(r.changePercent)}`}
              </Text>
            </View>
          ))}
          <Muted>Live ticks for your Monthly Picks and target companies. The KSE-100 above still refreshes every minute.</Muted>
        </View>
      ) : null}
      {updated ? <Muted>Updated {updated} PKT</Muted> : null}
    </Card>
  );
}
