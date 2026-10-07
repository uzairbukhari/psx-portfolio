import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { WEIGHT_CAP, money, moneyShort } from '@shared/portfolio.ts';
import { targetTotals } from '@shared/targets.ts';
import { monthTitle } from '@/data/format';
import { parseNumber } from '@/data/mutations';
import { buildPlan, currentMonth, setBudget, shiftMonth } from '@/data/sip';
import { usePortfolio } from '@/data/usePortfolio';
import { PicksView } from '@/screens/PicksView';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';
import { AppBar } from '@/ui/AppBar';
import { Icon } from '@/ui/Icon';
import { ReviewBuysSheet } from '@/ui/ReviewBuysSheet';
import { Avatar, Button, Card, Collapsible, Input, Loading, Muted, Notice, ProgressBar, Screen, Segmented, SectionLabel, Sheet, StepsBar, useKitStyles } from '@/ui/kit';

type Mode = 'targets' | 'picks';

function EmbeddedPlan({children}: {children:ReactNode;onRefresh?:()=>void;refreshing?:boolean}) {return <View style={{gap:14}}>{children}</View>}
export default function Plan({portfolioId,embedded=false}: {portfolioId?:string;embedded?:boolean} = {}) {
  const params = useLocalSearchParams<{ mode?: string }>();
  const p = usePortfolio(portfolioId);
  const styles = useKitStyles();
  const { colors } = useTheme();
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const [mode, setMode] = useState<Mode>(params.mode === 'picks' ? 'picks' : 'targets');
  // A link to /plan?mode=picks (the old /picks) switches an already-open screen too.
  useEffect(() => {
    if (params.mode === 'picks') setMode('picks');
    else if (params.mode === 'targets') setMode('targets');
  }, [params.mode]);
  const [fee, setFee] = useState('0');
  const [allowOld, setAllowOld] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [editingBudget, setEditingBudget] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const result = useMemo(() => (!p.isAll && p.portfolio ? buildPlan(p.portfolio, month, parseNumber(fee) ?? 0, allowOld) : null), [p.portfolio, month, fee, allowOld]);
  useEffect(()=>{setEditingBudget(false);setReviewing(false)},[p.selectedId]);
  const bar = <AppBar title="Plan" subtitle="Decide this month’s buys" />;

  if (p.isAll) return <Screen>{bar}{p.account?.portfolios.map((part)=><Card key={part.id}><Text style={styles.strong}>{part.name}</Text><Button label="Open portfolio to plan" variant="text" onPress={()=>p.select(part.id)} /><Plan portfolioId={part.id} embedded /></Card>)}</Screen>;
  if (p.isLoading)
    return (
      <Screen>
        {bar}
        <Loading />
      </Screen>
    );
  if (!p.portfolio || !result)
    return (
      <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
        {bar}
        <Notice tone="error" action={{ label: 'Try again', onPress: () => void p.refetch() }}>
          {p.error?.message ?? 'Could not load your portfolio.'}
        </Notice>
      </Screen>
    );

  const portfolio = p.portfolio;
  const plan = result.plan;
  const readOnly = embedded || p.locked || month < now;
  const targeted = portfolio.companies.filter((c) => c.target > 0);
  // The targets total gets its own notice with a way to fix it, so it is not repeated among the plan's errors.
  const planErrors = (plan?.errors ?? []).filter((e) => e !== 'Target weights must total 100%.');
  const priceProblem = planErrors.some((e) => /^Missing prices|^Older quotes/.test(e));
  const targetState = targetTotals(targeted.map((c) => ({ ticker: c.ticker, target: c.target })));
  const monthLabel = monthTitle(month);
  const monthName = monthTitle(month, false);
  // plan() falls back to PKR 100,000 for a month with no budget; that is not something the user chose.
  const budgetSet = portfolio.budgets[month] !== undefined;
  const spentFraction = plan && budgetSet && plan.budget > 0 ? plan.already / plan.budget : 0;
  const buys = plan && budgetSet && !plan.errors.length ? plan.rows.filter((r) => r.shares > 0 && r.price !== null) : [];
  const complete = Boolean(plan && budgetSet && !plan.errors.length && plan.remaining === 0);
  const feePct = parseNumber(fee) ?? 0;

  async function refreshPrices() {
    setPricing(true);
    setMessage(null);
    try {
      await p.refreshPrices();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not refresh prices.', error: true });
    } finally {
      setPricing(false);
    }
  }

  const arrow = (dir: -1 | 1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dir < 0 ? `Previous month, ${monthTitle(shiftMonth(month, -1))}` : `Next month, ${monthTitle(shiftMonth(month, 1))}`}
      onPress={() => setMonth(shiftMonth(month, dir))}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: pressed ? colors.raised : 'transparent', alignItems: 'center', justifyContent: 'center' })}
    >
      <Icon name={dir < 0 ? 'chevronLeft' : 'chevronRight'} size={22} color={colors.ink} />
    </Pressable>
  );

  const Container = embedded ? EmbeddedPlan : Screen;
  return (
    <Container onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      {embedded ? null : bar}
      <Card tone="hero">
        <View style={styles.row}>
          {arrow(-1)}
          <View style={{ alignItems: 'center', flexShrink: 1 }}>
            <Text style={styles.strong} accessibilityLiveRegion="polite">{monthLabel}</Text>
            <Text style={styles.muted}>{month === now ? 'This month' : month > now ? 'Upcoming' : 'Past month · read only'}</Text>
          </View>
          {arrow(1)}
        </View>
        <Text
          style={{ color: colors.ink, ...type.display, textAlign: 'center' }}
          accessibilityLabel={budgetSet ? `Budget for ${monthLabel}, ${moneyShort(plan?.budget ?? 0)}` : `No budget set for ${monthLabel}`}
        >
          {budgetSet ? moneyShort(plan?.budget ?? 0) : 'Not set'}
        </Text>
        <StepsBar fraction={spentFraction} />
        <View style={styles.row}>
          <Text style={styles.text}>Bought this month {moneyShort(plan?.already ?? 0)}</Text>
          {budgetSet ? <Text style={styles.number}>{moneyShort(plan?.remaining ?? 0)} left</Text> : null}
        </View>
        <Button
          label={budgetSet ? `Edit ${monthName} budget` : `Set ${monthName}’s budget`}
          variant={budgetSet ? 'outline' : 'primary'}
          disabled={readOnly}
          onPress={() => setEditingBudget(true)}
          accessibilityHint={readOnly ? 'Past months cannot be changed here' : undefined}
        />
      </Card>

      <Segmented label="Plan mode" value={mode} onChange={setMode} options={portfolio.companies.length ? [{ key: 'targets', label: 'Targets' }, { key: 'picks', label: '🧪 Monthly Picks' }] : [{ key: 'targets', label: 'Targets' }]} />
      {message ? <Notice tone={message.error ? 'error' : 'success'}>{message.text}</Notice> : null}
      {p.offline ? <Notice tone="offline">Offline · this plan is read only until you reconnect.</Notice> : null}

      {mode === 'picks' && portfolio.companies.length ? (
        <PicksView key={p.targetId ?? 'all'} portfolioId={portfolioId} month={month} fee={fee} onFee={setFee} readOnly={readOnly} />
      ) : targeted.length === 0 ? (
        <Card tone="hero">
          <Text style={styles.strong}>Choose your companies and targets</Text>
          <Muted>
            Sipwise splits each month's money toward the companies furthest below their target weight, in whole shares. Targets must add up to 100%, and any one
            company is capped at {WEIGHT_CAP}% of the portfolio.
          </Muted>
          {portfolio.companies.length === 0 ? <Muted>Add your first company by recording a purchase or importing your trades, then set its target here.</Muted> : null}
          <Button label="Set targets" icon="check" disabled={readOnly || portfolio.companies.length === 0} onPress={() => router.push('/targets')} />
          <Button label="Or start with Monthly Picks" variant="text" onPress={() => setMode('picks')} />
        </Card>
      ) : (
        <>
          {result.error ? <Notice tone="error">{result.error}</Notice> : null}
          {targetState.status !== 'exact' ? (
            <Notice action={{ label: 'Edit targets', onPress: () => router.push('/targets') }}>
              Your targets add up to {targetState.total}%, not 100%. Adjust them to get suggested buys.
            </Notice>
          ) : null}
          {priceProblem ? (
            <Notice action={{ label: pricing ? 'Refreshing…' : 'Refresh prices', onPress: () => void refreshPrices() }}>
              {planErrors.filter((e) => /^Missing prices|^Older quotes/.test(e)).join('\n')}
            </Notice>
          ) : null}
          {plan && !budgetSet ? <Notice action={{ label: `Set ${monthName}’s budget`, onPress: () => setEditingBudget(true) }}>Set a budget for {monthLabel} to see suggested buys.</Notice> : null}
          {plan && budgetSet && planErrors.filter((e) => !/^Missing prices|^Older quotes/.test(e)).length ? <Notice>{planErrors.filter((e) => !/^Missing prices|^Older quotes/.test(e)).join('\n')}</Notice> : null}
          {complete ? <Notice tone="success">All of this month’s budget is invested.</Notice> : null}

          {plan && budgetSet && !plan.errors.length ? (
            <>
              <SectionLabel>Suggested buys</SectionLabel>
              <Muted>Whole shares at the latest saved prices. Invested {money(plan.invested)}, leftover cash {money(plan.leftover)}.</Muted>
              <View style={[styles.card, { padding: 0, overflow: 'hidden' }]}>
                {plan.rows.map((r, i) => (
                  <View key={r.ticker} style={[{ padding: 14, gap: 10 }, i < plan.rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
                    <View style={styles.row} accessible accessibilityLabel={`${r.ticker}, ${r.name}. ${r.shares > 0 ? `${r.shares} shares, ${money(r.amount)}` : r.reason}. Now ${r.currentWeight.toFixed(1)} percent of a ${r.target} percent target.`}>
                      <Avatar ticker={r.ticker} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.strong}>{r.ticker}</Text>
                        <Text style={styles.muted} numberOfLines={1}>{r.name}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
                        <Text style={styles.number}>{r.shares > 0 ? `${r.shares} shares` : '—'}</Text>
                        <Text style={[styles.muted, { textAlign: 'right' }]}>{r.amount > 0 ? money(r.amount) : r.reason}</Text>
                      </View>
                    </View>
                    <View style={{ gap: 6 }}>
                      {/* Bar: current weight against its target (full bar = at target). */}
                      <ProgressBar fraction={r.target > 0 ? r.currentWeight / r.target : 0} tone={r.currentWeight > r.target ? colors.warn : colors.primary} />
                      <Muted>
                        Now {r.currentWeight.toFixed(1)}% of {r.target}% target · price {r.price === null ? 'not saved' : money(r.price)}
                      </Muted>
                    </View>
                    {r.shares > 0 && r.price !== null && !readOnly ? (
                      <Button
                        label={`Record only ${r.ticker}`}
                        variant="text"
                        style={{ alignSelf: 'flex-start' }}
                        onPress={() => router.push({ pathname: '/transaction', params: { ticker: r.ticker, kind: 'buy', shares: String(r.shares), price: String(r.price), month } })}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
              {buys.length && !readOnly ? (
                <Button
                  label={`Record all ${buys.length} ${buys.length === 1 ? 'buy' : 'buys'}…`}
                  icon="check"
                  disabled={p.offline}
                  onPress={() => setReviewing(true)}
                  accessibilityHint={p.offline ? 'Unavailable while offline' : 'Opens a review sheet; nothing is saved until you confirm'}
                />
              ) : null}
            </>
          ) : null}

          <Button label="Edit targets" variant="outline" icon="edit" onPress={() => router.push('/targets')} />
          <Collapsible title="Plan settings">
            <View style={[styles.row, { alignItems: 'flex-end' }]}>
              <View style={{ flex: 1 }}>
                <Input label="Fee estimate (%)" value={fee} onChangeText={setFee} keyboardType="decimal-pad" hint="Used to size whole-share buys and the estimated fees when you record." />
              </View>
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>Use older quotes</Text>
                <Muted>Plan with the latest saved prices even when they are not from the last trading day.</Muted>
              </View>
              <Switch accessibilityLabel="Use older quotes" value={allowOld} onValueChange={setAllowOld} trackColor={{ true: colors.primary, false: colors.line }} thumbColor={colors.surface} />
            </View>
            <Button label={pricing ? 'Refreshing prices…' : 'Refresh PSX prices'} variant="outline" icon="refresh" loading={pricing} onPress={() => void refreshPrices()} />
          </Collapsible>
          <ReviewBuysSheet visible={reviewing} onClose={() => setReviewing(false)} suggestions={buys} month={month} feePct={feePct} />
        </>
      )}

      <BudgetSheet key={month} visible={editingBudget} month={month} current={budgetSet ? portfolio.budgets[month] : null} onClose={() => setEditingBudget(false)} onSaved={(text) => setMessage({ text, error: false })} />
    </Container>
  );
}

/** Budget for one month. Keyed by month, so what is typed here can only ever be saved to the month it was opened for. */
function BudgetSheet({ visible, month, current, onClose, onSaved }: { visible: boolean; month: string; current: number | null; onClose: () => void; onSaved: (message: string) => void }) {
  const p = usePortfolio();
  const [text, setText] = useState(current === null ? '' : String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setText(current === null ? '' : String(current));
      setError(null);
    }
  }, [visible, current]);

  async function save() {
    if (!p.portfolio || busy) return;
    setBusy(true);
    setError(null);
    try {
      const amount = parseNumber(text);
      if (amount === null) throw new Error('Enter the monthly budget.');
      await p.save(setBudget(p.portfolio, month, amount));
      onSaved(`Budget for ${monthTitle(month)} saved.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the budget.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet visible={visible} title={`Budget for ${monthTitle(month)}`} onClose={onClose}>
      <Input label={`Budget for ${monthTitle(month)} (PKR)`} placeholder="e.g. 100000" value={text} onChangeText={setText} keyboardType="decimal-pad" autoFocus />
      <Muted>Only {monthTitle(month)} changes. Each month keeps its own budget.</Muted>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button label={`Save ${monthTitle(month, false)}`} loading={busy} disabled={p.offline} onPress={() => void save()} />
      {p.offline ? <Muted>You are offline, so saving is paused until you reconnect.</Muted> : null}
    </Sheet>
  );
}
