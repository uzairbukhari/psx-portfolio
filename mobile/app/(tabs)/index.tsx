import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { money, moneyShort } from '@shared/portfolio.ts';
import { formatPercent } from '@/data/derive';
import { usePortfolio } from '@/data/usePortfolio';
import { colors, type } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { MarketPulse } from '@/ui/MarketPulse';
import { Amount, Avatar, Button, Card, EmptyState, Header, ListRow, Loading, Notice, Screen, SectionLabel, Stat, styles } from '@/ui/kit';

export default function Holdings() {
  const p = usePortfolio();
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);

  if (p.isLoading)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!p.view)
    return (
      <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
        <Header title="Holdings" />
        <Notice tone="error">{p.error?.message ?? 'Could not load your portfolio.'}</Notice>
        <Button label="Try again" variant="secondary" onPress={() => void p.refetch()} />
      </Screen>
    );

  const { totals, open, error } = p.view;
  const gainColor = totals.gain === null || totals.gain === 0 ? colors.muted : totals.gain > 0 ? colors.success : colors.danger;
  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Header
        title="Holdings"
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add transaction"
            onPress={() => router.push('/transaction')}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: colors.primarySoft,
              borderRadius: 999,
              paddingVertical: 8,
              paddingHorizontal: 14,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Icon name="plus" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 14 }}>Add</Text>
          </Pressable>
        }
      />
      {p.offline ? <Notice>Offline. Showing your last saved portfolio.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card tone="hero">
        <Text style={[styles.sectionLabel]}>{totals.incomplete.includes('missing-price') ? 'Priced holdings · incomplete' : 'Portfolio value'}</Text>
        <Text style={{ color: colors.foreground, ...type.hero, fontVariant: ['tabular-nums'] }}>
          {totals.heldCount > 0 && totals.missingPrice.length === totals.heldCount ? 'Prices needed' : moneyShort(totals.value)}
        </Text>
        {totals.gain === null ? (
          <Text style={styles.muted}>Unrealised gain on current holdings: not yet known</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ transform: [{ scaleY: totals.gain < 0 ? -1 : 1 }] }}>
                <Icon name="trendingUp" size={16} color={gainColor} />
              </View>
              <Text style={{ color: gainColor, fontWeight: '600', fontSize: 15 }}>
                {moneyShort(totals.gain)} · {formatPercent(totals.gainPercent)}
              </Text>
            </View>
            <Text style={styles.muted}>Unrealised gain on current holdings</Text>
          </>
        )}
        <View style={styles.divider} />
        <View style={styles.row}>
          <Stat label="Cost of current holdings">
            <Text style={styles.strong}>{totals.cost === null ? 'Not yet known' : moneyShort(totals.cost)}</Text>
          </Stat>
          <Stat label="Open positions">
            <Text style={styles.strong}>{open.length}</Text>
          </Stat>
          <Stat label="Oldest price">
            <Text style={styles.strong}>{totals.oldestQuoteDate ?? '—'}</Text>
          </Stat>
        </View>
        {totals.missingPrice.length ? (
          <Text style={styles.muted}>
            {totals.missingPrice.length} position(s) need a price ({totals.missingPrice.join(', ')}), so the gain is not shown. Realised gains and dividends are not included.
          </Text>
        ) : null}
        {totals.unknownCost.length ? (
          <Text style={styles.muted}>Cost is not known for {totals.unknownCost.join(', ')}, so cost and gain are not shown.</Text>
        ) : null}
        {!totals.incomplete.length ? <Text style={styles.muted}>Realised gains and dividends are not included. See Reports for total return.</Text> : null}
      </Card>

      <MarketPulse />

      <Button
        label={pricing ? 'Refreshing prices…' : 'Refresh PSX prices'}
        variant="secondary"
        icon="refresh"
        loading={pricing}
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
      />
      {priceError ? <Notice tone="error">{priceError}</Notice> : null}

      <SectionLabel>Your companies</SectionLabel>
      {open.length === 0 ? (
        <EmptyState
          icon="holdings"
          title="No open positions yet"
          body="Add your first trade or import your broker history from the Account tab."
          action={<Button label="Add a trade" icon="plus" onPress={() => router.push('/transaction')} />}
        />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {open.map((h, i) => (
            <ListRow
              key={h.ticker}
              left={<Avatar ticker={h.ticker} />}
              title={h.ticker}
              subtitle={`${new Intl.NumberFormat('en-PK').format(h.shares)} shares · avg ${h.average === null ? '—' : money(h.average)}`}
              right={
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={[styles.strong, { fontVariant: ['tabular-nums'] }]}>{h.value === null ? 'No price' : moneyShort(h.value)}</Text>
                  <Amount value={h.gain} text={h.gain === null ? '—' : moneyShort(h.gain)} size={13} />
                </View>
              }
              onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: h.ticker } })}
              last={i === open.length - 1}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
