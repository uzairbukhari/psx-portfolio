import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { money, moneyShort } from '@shared/portfolio.ts';
import { formatPercent } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { MarketPulse } from '@/ui/MarketPulse';
import { Amount, Card, Muted, Notice, Screen, Stat, Title, styles } from '@/ui/kit';

export default function Holdings() {
  const p = usePortfolio();
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  if (p.isLoading)
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </Screen>
    );
  if (!p.view)
    return (
      <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
        <Notice tone="error">{p.error?.message ?? 'Could not load your portfolio.'}</Notice>
      </Screen>
    );

  const { totals, open, error } = p.view;
  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <View style={styles.row}>
        <Title>Holdings</Title>
        <Pressable onPress={() => router.push('/transaction')} style={{ paddingVertical: 6, paddingHorizontal: 12 }}>
          <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 15 }}>+ Add</Text>
        </Pressable>
      </View>
      {p.offline ? <Notice>Offline. Showing your last saved portfolio.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card>
        <Muted>Portfolio value</Muted>
        <Text style={{ color: colors.foreground, fontSize: 34, fontWeight: '700' }}>{moneyShort(totals.value)}</Text>
        <View style={styles.row}>
          <Stat label="Cost">
            <Text style={styles.strong}>{moneyShort(totals.cost)}</Text>
          </Stat>
          <Stat label="Gain">
            <Amount value={totals.gain} text={moneyShort(totals.gain)} />
          </Stat>
          <Stat label="Return">
            <Amount value={totals.gain} text={formatPercent(totals.gainPercent)} />
          </Stat>
        </View>
        {totals.unpriced ? (
          <Muted>{totals.unpriced} position(s) without a price or known cost are left out of these totals.</Muted>
        ) : null}
      </Card>
      <MarketPulse />
      <Pressable
        style={[styles.secondary, pricing && { opacity: 0.5 }]}
        disabled={pricing}
        onPress={async () => {
          setPricing(true);
          setPriceError(null);
          try {
            await p.refreshPrices();
          } catch (e) {
            setPriceError(e instanceof Error ? e.message : 'Could not refresh prices.');
          } finally {
            setPricing(false);
          }
        }}
      >
        <Text style={styles.secondaryText}>{pricing ? 'Refreshing prices…' : 'Refresh PSX prices'}</Text>
      </Pressable>
      {priceError ? <Notice tone="error">{priceError}</Notice> : null}
      {open.length === 0 ? <Muted>No open positions yet.</Muted> : null}
      {open.map((h) => (
        <Pressable key={h.ticker} onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: h.ticker } })}>
          <Card>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.strong}>{h.ticker}</Text>
                <Muted>{h.name}</Muted>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.strong}>{h.value === null ? 'No price' : moneyShort(h.value)}</Text>
                <Amount value={h.gain} text={h.gain === null ? '—' : moneyShort(h.gain)} size={13} />
              </View>
            </View>
            <Muted>
              {new Intl.NumberFormat('en-PK').format(h.shares)} shares · avg {h.average === null ? '—' : money(h.average)}
              {h.quote ? ` · last ${money(h.quote.price)}` : ''}
            </Muted>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
