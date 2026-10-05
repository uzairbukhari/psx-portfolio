import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { moneyShort, today } from '@shared/portfolio.ts';
import { lastTradingDay } from '@shared/psx-calendar.ts';
import { monthTitle, pktTime, plural, shortDate, signedMoney, signedPercent } from '@/data/format';
import { currentMonth } from '@/data/sip';
import { monthProgress, nextActions, returnBreakdown, type NextAction } from '@/data/today';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { AppBar } from '@/ui/AppBar';
import { Icon, type IconName } from '@/ui/Icon';
import { watchTickers } from '@shared/market-watch.ts';
import { MarketPulse } from '@/ui/MarketPulse';
import { ValueVsMoneyInCard } from '@/ui/TrackRecordCards';
import { Amount, Button, Card, EmptyState, ListRow, Loading, Notice, Screen, SectionLabel, Stat, StatusChip, StepsBar, useKitStyles } from '@/ui/kit';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateLine = (iso: string) => `${WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${shortDate(iso)}`;

const ACTION_ICON: Record<NextAction['key'], IconName> = { dividend: 'inbox', prices: 'refresh', targets: 'check', budget: 'calendar', plan: 'calendarCheck' };

export default function Today() {
  const p = usePortfolio();
  const styles = useKitStyles();
  const { colors } = useTheme();
  const [showReturn, setShowReturn] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const now = today();
  const month = currentMonth();

  const progress = useMemo(() => (p.portfolio ? monthProgress(p.portfolio, month) : null), [p.portfolio, month]);
  const actions = useMemo(() => (p.portfolio && p.view ? nextActions(p.portfolio, p.view.held, month, now) : []), [p.portfolio, p.view, month, now]);
  const breakdown = useMemo(() => (p.portfolio && p.view ? returnBreakdown(p.portfolio, p.view.totals.gain) : null), [p.portfolio, p.view]);

  const bar = <AppBar title="Today" subtitle={dateLine(now)} />;
  if (p.isLoading)
    return (
      <Screen>
        {bar}
        <Loading />
      </Screen>
    );
  if (!p.view || !p.portfolio || !progress)
    return (
      <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
        {bar}
        <Card>
          <Notice tone="error" action={{ label: 'Try again', onPress: () => void p.refetch() }}>
            {p.error?.message ?? 'Could not load your portfolio.'}
          </Notice>
        </Card>
      </Screen>
    );

  const { totals, open, error } = p.view;
  const firstUse = p.portfolio.companies.length === 0 && p.portfolio.trades.length === 0;
  const lastDay = lastTradingDay(now);
  const oldPrices = totals.oldestQuoteDate !== null && totals.oldestQuoteDate < lastDay;
  const priceNeeded = totals.heldCount > 0 && totals.missingPrice.length === totals.heldCount;
  const savedTime = pktTime(p.savedAt ? new Date(p.savedAt).toISOString() : null);

  async function refreshPrices() {
    setPricing(true);
    setMessage(null);
    try {
      await p.refreshPrices();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not refresh prices.');
    } finally {
      setPricing(false);
    }
  }

  function run(a: NextAction) {
    if (a.key === 'dividend') router.push({ pathname: '/received', params: { id: a.id } });
    else if (a.key === 'prices') void refreshPrices();
    else if (a.key === 'targets') router.push('/targets');
    else router.push('/plan');
  }

  if (firstUse && !skipped)
    return (
      <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching} fab={false}>
        <AppBar title="Welcome" subtitle="Let’s set up your portfolio" />
        {p.offline ? <Notice tone="offline" action={{ label: 'Retry', onPress: () => void p.refetch() }}>{`Offline${savedTime ? ` · showing your saved copy from ${savedTime}` : ''}`}</Notice> : null}
        <SectionLabel>Start with</SectionLabel>
        <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
          <ListRow left={<StartIcon name="upload" />} title="Import AHL trade history" subtitle="JSON export from AHL" onPress={() => router.push({ pathname: '/import', params: { kind: 'ahl' } })} />
          <ListRow left={<StartIcon name="upload" />} title="Import CDC dividends" subtitle="JSON from CDC" onPress={() => router.push({ pathname: '/import', params: { kind: 'cdc' } })} />
          <ListRow left={<StartIcon name="plus" />} title="Add my first holding" subtitle="Enter a buy by hand" onPress={() => router.push('/transaction')} />
          <ListRow left={<StartIcon name="chevronRight" />} title="Skip for now" subtitle="You can import later from Activity" onPress={() => setSkipped(true)} last />
        </View>
        <Text style={styles.muted}>Prices are delayed PSX quotes, and every figure says which date it used. Your data syncs with the Sipwise website.</Text>
      </Screen>
    );

  const headline = priceNeeded ? 'Prices needed' : moneyShort(totals.value);
  const incomplete = totals.incomplete.length > 0;
  const label = totals.missingPrice.length ? 'Market value of priced holdings' : 'Market value of holdings';

  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching} fab>
      {bar}
      {p.offline ? <Notice tone="offline" action={{ label: 'Retry', onPress: () => void p.refetch() }}>{`Offline · showing your saved copy${savedTime ? ` from ${savedTime}` : ''}. Changes are paused until you are back online.`}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="error">{message}</Notice> : null}

      <Card tone="hero">
        <Text style={styles.sectionLabel}>{label}{incomplete && !totals.missingPrice.length ? ' · incomplete' : ''}</Text>
        {oldPrices ? <StatusChip tone="warn" text={`Prices as of ${shortDate(totals.oldestQuoteDate)}`} /> : null}
        {totals.missingPrice.length ? <StatusChip tone="warn" text={`${plural(totals.missingPrice.length, 'holding')} ${totals.missingPrice.length === 1 ? 'needs' : 'need'} a price`} /> : null}
        <Text style={{ color: colors.ink, ...type.display }} accessibilityLabel={priceNeeded ? 'Prices needed' : `${label}, ${moneyShort(totals.value)}`}>
          {headline}
        </Text>
        {totals.gain === null ? (
          <Text style={styles.muted}>Unrealised gain on current holdings: not yet known{totals.missingPrice.length ? ` (add a price for ${totals.missingPrice.join(', ')})` : ''}</Text>
        ) : (
          <View style={{ gap: 2 }}>
            <Amount value={totals.gain} text={`${signedMoney(totals.gain)} (${signedPercent(totals.gainPercent)})`} size={17} label="Unrealised gain on current holdings" weight="700" />
            <Text style={styles.muted}>unrealised gain on current holdings</Text>
          </View>
        )}
        <View style={styles.divider} />
        <View style={styles.row}>
          <Stat label="Cost of current holdings">
            <Text style={styles.number}>{totals.cost === null ? 'Not yet known' : moneyShort(totals.cost)}</Text>
          </Stat>
          <Stat label="Holdings">
            <Text style={styles.number}>{plural(open.length, 'company', 'companies')}</Text>
          </Stat>
        </View>
        {totals.unknownCost.length ? <Text style={styles.muted}>Cost is not known for {totals.unknownCost.join(', ')}, so cost and gain are not shown. Edit the opening entry to add its cost.</Text> : null}

        {showReturn && breakdown ? (
          <View style={{ gap: 8 }}>
            <View style={styles.divider} />
            <Line label="Unrealised gain" value={breakdown.unrealised} />
            <Line label="Realised gain (sales)" value={breakdown.realised} />
            <Line label="Dividends received" value={breakdown.dividendsReceived} plain />
            <Line label="Total return" value={breakdown.totalBeforeTax} strong />
            <Text style={styles.muted}>
              Before estimated capital gains tax{breakdown.afterTax !== null ? `; after estimated tax ${signedMoney(breakdown.afterTax)}` : ''}. Expected dividends
              {breakdown.expected.count ? ` (${plural(breakdown.expected.count, 'announcement')}, about ${moneyShort(breakdown.expected.gross)})` : ''} are not included.
            </Text>
          </View>
        ) : null}
        <Button label={showReturn ? 'Hide total return' : 'See total return'} variant="text" onPress={() => setShowReturn((v) => !v)} accessibilityHint="Shows realised gains, dividends received and total return" />
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>This month · {monthTitle(month)}</Text>
        {progress.budgetSet ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }} accessible accessibilityLabel={`Bought this month ${moneyShort(progress.bought)} of ${moneyShort(progress.budget)} budget. ${moneyShort(progress.remaining)} left.`}>
              <Text style={{ color: colors.ink, ...type.title }}>{moneyShort(progress.bought)}</Text>
              <Text style={styles.muted}>of {moneyShort(progress.budget)}</Text>
            </View>
            <StepsBar fraction={progress.fraction} />
            <View style={styles.row}>
              <Text style={styles.muted}>Bought this month</Text>
              <Text style={styles.muted}>{progress.remaining > 0 ? `${moneyShort(progress.remaining)} left` : 'All of this month’s budget is invested'}</Text>
            </View>
            {progress.suggested > 0 ? <StatusChip tone="primary" text={`${plural(progress.suggested, 'buy')} suggested`} icon="calendarCheck" /> : null}
          </>
        ) : (
          <Text style={styles.text}>No budget set for {monthTitle(month, false)}. Set one and Sipwise suggests whole-share buys toward your targets.</Text>
        )}
        <Button
          label={progress.suggested > 0 ? 'Plan this month’s buys' : !progress.budgetSet ? `Set ${monthTitle(month, false)}’s budget` : 'Open this month’s plan'}
          variant={progress.suggested > 0 || !progress.budgetSet ? 'primary' : 'tonal'}
          onPress={() => router.push('/plan')}
        />
      </Card>

      {actions.length ? (
        <>
          <SectionLabel>Next actions</SectionLabel>
          <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
            {actions.map((a, i) => (
              <ListRow
                key={a.key}
                left={<StartIcon name={ACTION_ICON[a.key]} />}
                title={a.title}
                subtitle={a.key === 'prices' && pricing ? 'Refreshing prices…' : a.detail}
                accessibilityHint={a.key === 'prices' ? 'Refreshes prices now' : undefined}
                onPress={() => run(a)}
                wrapTitle
                last={i === actions.length - 1}
              />
            ))}
          </View>
        </>
      ) : open.length === 0 ? (
        <EmptyState icon="holdings" title="No open positions yet" body="Record your first buy or import your broker history." action={<Button label="Add a trade" icon="plus" onPress={() => router.push('/transaction')} />} />
      ) : null}

      {open.length > 0 || totals.heldCount > 0 ? <ValueVsMoneyInCard collapsible /> : null}

      <MarketPulse tickers={watchTickers(p.portfolio)} />
    </Screen>
  );
}

function StartIcon({ name }: { name: IconName }) {
  const { colors } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={name} size={20} color={colors.primary} />
    </View>
  );
}

function Line({ label, value, strong = false, plain = false }: { label: string; value: number | null; strong?: boolean; plain?: boolean }) {
  const styles = useKitStyles();
  return (
    <View style={styles.row}>
      <Text style={[strong ? styles.strong : styles.text, { flexShrink: 1 }]}>{label}</Text>
      {value === null ? (
        <Text style={styles.muted}>Not yet known</Text>
      ) : plain ? (
        <Text style={styles.number}>{moneyShort(value)}</Text>
      ) : (
        <Amount value={value} size={strong ? 17 : 15} weight={strong ? '700' : '600'} label={label} />
      )}
    </View>
  );
}
