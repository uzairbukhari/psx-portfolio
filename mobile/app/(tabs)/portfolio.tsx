import { useEffect, useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { moneyShort, today } from '@shared/portfolio.ts';
import { signedAmountLabel } from '@/data/a11y';
import { soldOutPositions } from '@/data/derive';
import { shortDate } from '@/data/format';
import { HOLDING_SORTS, filterBySector, holdingFlags, pricedLine, sectorsOf, sortHoldings, weightOf, type HoldingSort } from '@/data/holdings-view';
import { useScope } from '@/data/useScope';
import { MutualFunds } from '@/ui/MutualFunds';
import { usePortfolio } from '@/data/usePortfolio';
import { Insights } from '@/screens/Insights';
import { useTheme } from '@/theme/ThemeProvider';
import { AssetMix, OverviewHero, PortfolioBreakdown } from '@/ui/AccountOverview';
import { HoldingRow } from '@/ui/HoldingRow';
import { AppBar } from '@/ui/AppBar';
import { GoldSilver } from '@/ui/GoldSilver';
import { SavingsPlans } from '@/ui/SavingsPlans';
import { Icon } from '@/ui/Icon';
import { Amount, Avatar, Button, Chip, EmptyState, ListRow, Loading, Notice, Screen, Segmented, SectionHeader, Sheet, useKitStyles } from '@/ui/kit';

type Segment = 'holdings' | 'insights';

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

  const scope = useScope();
  const { metals: ownedMetals, plans: ownedPlans, funds: ownedFunds, metal, fundNavs, overview, hasAssets } = scope;
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
          {overview ? <OverviewHero o={overview} label={p.isAll ? 'Net worth · all portfolios' : `Net worth · ${p.portfolioName}`} /> : null}
          {overview ? <AssetMix o={overview} /> : null}
          {overview && p.isAll ? <PortfolioBreakdown o={overview} onOpenPortfolio={(id) => p.select(id)} /> : null}

          {open.length > 0 ? (
            <>
              <SectionHeader title="Stocks" count={open.length} value={totals.heldCount > 0 && totals.missingPrice.length === totals.heldCount ? 'Prices needed' : moneyShort(totals.value)} />
              {line ? <Text style={styles.muted}>{line}</Text> : null}
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
              {shown.length === 0 ? (
                <EmptyState icon="filter" title="No holdings in that sector" body="Choose another sector in Sort and filter." />
              ) : (
                <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
                  {shown.map((h, i) => (
                    <HoldingRow
                      key={h.ticker}
                      h={h}
                      flags={flags.get(h.ticker)}
                      weight={sort === 'weight' ? weightOf(h, total) : undefined}
                      onPress={() => router.push({ pathname: '/company/[ticker]', params: { ticker: h.ticker } })}
                      last={i === shown.length - 1}
                    />
                  ))}
                </View>
              )}
            </>
          ) : null}

          <MutualFunds owned={ownedFunds} navs={fundNavs.navs} navsError={fundNavs.error} />
          <SavingsPlans owned={ownedPlans} />
          <GoldSilver owned={ownedMetals} rates={metal.rates} ratesError={metal.error} />

          {open.length === 0 && !hasAssets ? (
            <EmptyState
              icon="holdings"
              title={p.isAll ? 'Nothing in your portfolios yet' : `Nothing in ${p.portfolioName} yet`}
              body="Add your first trade to start. Funds, savings plans and gold you add on the web show up here too."
              action={<Button label="Add a trade" icon="plus" onPress={() => router.push('/transaction')} />}
            />
          ) : null}

          {(showSoldOut || open.length === 0) && soldOut.length ? (
            <>
              <SectionHeader title="Sold out" count={soldOut.length} />
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
