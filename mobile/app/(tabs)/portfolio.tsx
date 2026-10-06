import { useEffect, useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { DISPLAY_PARTS, money, moneyShort, today } from '@shared/portfolio.ts';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import { soldOutPositions } from '@/data/derive';
import { shortDate, signedMoney, signedPercent } from '@/data/format';
import { HOLDING_SORTS, filterBySector, holdingFlags, pricedLine, sectorsOf, sortHoldings, weightOf, type HoldingSort } from '@/data/holdings-view';
import { useMetalRates } from '@/data/useMetalRates';
import { useFundNavs } from '@/data/useFundNavs';
import { MutualFunds } from '@/ui/MutualFunds';
import { usePortfolio } from '@/data/usePortfolio';
import { Insights } from '@/screens/Insights';
import { useTheme } from '@/theme/ThemeProvider';
import { AccountOverview } from '@/ui/AccountOverview';
import { AppBar } from '@/ui/AppBar';
import { GoldSilver } from '@/ui/GoldSilver';
import { SavingsPlans } from '@/ui/SavingsPlans';
import { Icon } from '@/ui/Icon';
import { Amount, Avatar, Button, Chip, EmptyState, ListRow, Loading, Notice, Screen, Segmented, SectionLabel, Sheet, StatusChip, useKitStyles } from '@/ui/kit';

type Segment = 'holdings' | 'insights';
const fmt = new Intl.NumberFormat('en-PK');

export default function Portfolio() {
  const params = useLocalSearchParams<{ segment?: string }>();
  const p = usePortfolio();
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [segment, setSegment] = useState<Segment>(params.segment === 'insights' ? 'insights' : 'holdings');
  // A link to /portfolio?segment=insights (the old /reports) switches an already-open screen too.
  useEffect(() => {
    if (params.segment === 'insights') setSegment('insights');
    else if (params.segment === 'holdings') setSegment('holdings');
  }, [params.segment]);
  const [sort, setSort] = useState<HoldingSort>('value');
  const [sector, setSector] = useState<string | null>(null);
  const [showSoldOut, setShowSoldOut] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const now = today();

  const open = p.view?.open ?? [];
  const soldOut = useMemo(() => (p.portfolio && p.view ? soldOutPositions(p.portfolio, p.view.held) : []), [p.portfolio, p.view]);
  const sectors = useMemo(() => sectorsOf(open), [open]);
  const shown = useMemo(() => sortHoldings(filterBySector(open, sector), sort), [open, sector, sort]);
  const flags = useMemo(() => (p.portfolio ? holdingFlags(p.portfolio, open, now) : new Map()), [p.portfolio, open, now]);
  const total = open.reduce((a, h) => a + (h.value ?? 0), 0);

  const overviewParts = p.isAll ? p.portfolio?.[DISPLAY_PARTS] : undefined;
  const allAssets = overviewParts
    ? overviewParts.flatMap((part) => (part.portfolio.assets ?? []).map((asset) => ({ asset, portfolioName: part.name })))
    : (p.portfolio?.assets ?? []).map((asset) => ({ asset, portfolioName: undefined }));
  const ownedMetals = allAssets.flatMap((o) => (o.asset.kind === 'metal' ? [{ ...o, asset: o.asset }] : []));
  const ownedPlans = allAssets.flatMap((o) => (o.asset.kind === 'plan' ? [{ ...o, asset: o.asset }] : []));
  const ownedFunds = allAssets.flatMap((o) => (o.asset.kind === 'fund' ? [{ ...o, asset: o.asset }] : []));
  const metal = useMetalRates(ownedMetals.length > 0);
  const fundNavs = useFundNavs(ownedFunds.length > 0);
  const bar = <AppBar title="Portfolio" />;
  const switcher = <Segmented label="Portfolio view" value={segment} onChange={setSegment} options={[{ key: 'holdings', label: 'Holdings' }, { key: 'insights', label: 'Insights' }]} />;

  if (p.isLoading)
    return (
      <Screen>
        {bar}
        <Loading />
      </Screen>
    );
  if (!p.view)
    return (
      <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
        {bar}
        <Notice tone="error" action={{ label: 'Try again', onPress: () => void p.refetch() }}>
          {p.error?.message ?? 'Could not load your portfolio.'}
        </Notice>
      </Screen>
    );

  const { totals, error } = p.view;
  const line = pricedLine(open, totals.oldestQuoteDate, (d) => shortDate(d, Number(now.slice(0, 4))));

  async function refreshPrices() {
    setPricing(true);
    setPriceError(null);
    try {
      await p.refreshPrices();
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : 'Could not refresh prices.');
    } finally {
      setPricing(false);
    }
  }

  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching} fab={segment === 'holdings'}>
      {bar}
      {switcher}
      {p.offline ? <Notice tone="offline">Offline · showing your saved copy.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {segment === 'insights' ? (
        <Insights />
      ) : (
        <>
          {overviewParts && overviewParts.length > 1 ? <AccountOverview parts={overviewParts} rates={metal.rates} fundNavs={fundNavs.navs} onOpenPortfolio={(id) => p.select(id)} /> : null}
          {overviewParts && overviewParts.length > 1 ? <SectionLabel>All companies</SectionLabel> : null}
          {line ? (
            <View style={styles.row} accessible accessibilityLabel={`${line}. Market value ${totals.value ? moneyShort(totals.value) : 'not available'}.`}>
              <Text style={[styles.muted, { flexShrink: 1 }]}>{line}</Text>
              <Text style={styles.number}>{totals.heldCount > 0 && totals.missingPrice.length === totals.heldCount ? 'Prices needed' : moneyShort(totals.value)}</Text>
            </View>
          ) : null}

          <View style={[styles.row, { flexWrap: 'wrap' }]}>
            <Button
              label={`Sort: ${HOLDING_SORTS.find((s) => s.key === sort)?.label}${sector ? ` · ${sector}` : ''}`}
              variant="outline"
              icon="filter"
              onPress={() => setSheet(true)}
              accessibilityHint="Opens sort and sector filter"
            />
            {soldOut.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }}>
                <Text style={styles.text}>Include sold</Text>
                <Switch
                  value={showSoldOut}
                  onValueChange={setShowSoldOut}
                  accessibilityLabel={`Include sold out companies, ${soldOut.length} available`}
                  trackColor={{ true: colors.primary, false: colors.line }}
                  thumbColor={colors.surface}
                />
              </View>
            ) : null}
          </View>

          {totals.missingPrice.length ? (
            <Notice tone="warn" action={{ label: pricing ? 'Refreshing…' : 'Refresh prices', onPress: () => void refreshPrices() }}>
              {totals.missingPrice.length} {totals.missingPrice.length === 1 ? 'holding needs' : 'holdings need'} a price ({totals.missingPrice.join(', ')}), so the total is incomplete.
            </Notice>
          ) : null}
          {priceError ? <Notice tone="error">{priceError}</Notice> : null}

          {open.length === 0 ? (
            <EmptyState
              icon="holdings"
              title="No open positions yet"
              body="Add your first trade or import your broker history from Activity."
              action={<Button label="Add a trade" icon="plus" onPress={() => router.push('/transaction')} />}
            />
          ) : shown.length === 0 ? (
            <EmptyState icon="filter" title="No holdings in that sector" body="Choose another sector in Sort and filter." />
          ) : (
            <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
              {shown.map((h, i) => {
                const flag = flags.get(h.ticker);
                const gainPct = h.gain === null || !h.cost ? null : (h.gain / h.cost) * 100;
                const weight = weightOf(h, total);
                return (
                  <ListRow
                    key={h.ticker}
                    left={<Avatar ticker={h.ticker} />}
                    title={h.ticker}
                    wrapTitle
                    subtitle={`${h.name}\n${fmt.format(h.shares)} sh · avg ${h.average === null ? '—' : money(h.average)}${sort === 'weight' && weight !== null ? ` · ${weight.toFixed(1)}% of value` : ''}`}
                    footer={
                      flag?.stale || flag?.expectedDividend || h.value === null ? (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                          {h.value === null ? <StatusChip tone="warn" text="No price" /> : flag?.stale ? <StatusChip tone="warn" text={`Stale price · ${shortDate(h.quote!.date)}`} /> : null}
                          {flag?.expectedDividend ? <StatusChip tone="primary" text="Expected dividend" icon="inbox" /> : null}
                        </View>
                      ) : undefined
                    }
                    right={
                      <View style={{ alignItems: 'flex-end', gap: 2, maxWidth: '44%' }}>
                        <Text style={styles.number}>{h.value === null ? '—' : moneyShort(h.value)}</Text>
                        {h.gain === null ? null : <Amount value={h.gain} text={`${signedMoney(h.gain)}${gainPct === null ? '' : ` (${signedPercent(gainPct)})`}`} size={13} label="Unrealised" />}
                      </View>
                    }
                    accessibilityLabel={[
                      h.ticker,
                      h.name,
                      `${fmt.format(h.shares)} shares`,
                      h.average === null ? '' : `average cost ${money(h.average)}`,
                      h.value === null ? 'no price yet' : `value ${moneyShort(h.value)}`,
                      h.gain === null ? '' : `unrealised ${signedAmountLabel(h.gain)}${gainPct === null ? '' : `, ${signedPercentLabel(gainPct)}`}`,
                      flag?.stale && h.quote ? `price from ${shortDate(h.quote.date)}, stale` : '',
                      flag?.expectedDividend ? 'dividend expected' : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    accessibilityHint="Opens the company"
                    onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: h.ticker } })}
                    last={i === shown.length - 1}
                  />
                );
              })}
            </View>
          )}

          <GoldSilver owned={ownedMetals} rates={metal.rates} ratesError={metal.error} />
          <SavingsPlans owned={ownedPlans} />
          <MutualFunds owned={ownedFunds} navs={fundNavs.navs} navsError={fundNavs.error} />

          {showSoldOut && soldOut.length ? (
            <>
              <SectionLabel>Sold out</SectionLabel>
              <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
                {soldOut.map((h, i) => (
                  <ListRow
                    key={h.ticker}
                    left={<Avatar ticker={h.ticker} />}
                    title={h.ticker}
                    subtitle={`${h.name} · fully sold`}
                    right={<Amount value={h.realized} size={13} label="Realised" />}
                    accessibilityLabel={`${h.ticker}, ${h.name}, fully sold, realised ${signedAmountLabel(h.realized)}`}
                    accessibilityHint="Opens the company"
                    onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: h.ticker } })}
                    last={i === soldOut.length - 1}
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}

      <Sheet visible={sheet} title="Sort and filter" onClose={() => setSheet(false)}>
        <Text style={styles.sectionLabel}>Sort by</Text>
        <View style={[styles.card, { padding: 0, overflow: 'hidden' }]} accessibilityRole="radiogroup">
          {HOLDING_SORTS.map((s, i) => (
            <ListRow
              key={s.key}
              title={s.label}
              subtitle={s.hint}
              accessibilityLabel={`${s.label}. ${s.hint}${sort === s.key ? '. Selected' : ''}`}
              right={sort === s.key ? <Icon name="check" size={20} color={colors.primary} strokeWidth={2.6} /> : undefined}
              onPress={() => {
                setSort(s.key);
                if (sectors.length <= 1) setSheet(false);
              }}
              last={i === HOLDING_SORTS.length - 1}
            />
          ))}
        </View>
        {sectors.length > 1 ? (
          <>
            <Text style={styles.sectionLabel}>Sector</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
              <Chip role="radio" label="All sectors" selected={sector === null} onPress={() => setSector(null)} />
              {sectors.map((x) => (
                <Chip key={x} role="radio" label={x} selected={sector === x} onPress={() => setSector(x)} />
              ))}
            </View>
          </>
        ) : null}
        <Button label="Done" onPress={() => setSheet(false)} />
      </Sheet>
    </Screen>
  );
}
