import { useMemo, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { money, moneyShort } from '@shared/portfolio.ts';
import { parseNumber } from '@/data/mutations';
import { buildPlan, currentMonth, setBudget, shiftMonth } from '@/data/sip';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Avatar, Button, Card, EmptyState, Header, Input, Loading, Muted, Notice, ProgressBar, Screen, SectionLabel, Stat, styles } from '@/ui/kit';

export default function Sip() {
  const p = usePortfolio();
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const [fee, setFee] = useState('0');
  const [allowOld, setAllowOld] = useState(false);
  const [budgetText, setBudgetText] = useState<string | null>(null);
  const [savingBudget, setSavingBudget] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const result = useMemo(
    () => (p.portfolio ? buildPlan(p.portfolio, month, parseNumber(fee) ?? 0, allowOld) : null),
    [p.portfolio, month, fee, allowOld],
  );

  if (p.isLoading)
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  if (!p.portfolio || !result)
    return (
      <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
        <Header title="Monthly SIP" />
        <Notice tone="error">{p.error?.message ?? 'Could not load your portfolio.'}</Notice>
        <Button label="Try again" variant="secondary" onPress={() => void p.refetch()} />
      </Screen>
    );

  const plan = result.plan;
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  async function saveBudget() {
    if (!p.portfolio || budgetText === null) return;
    setSavingBudget(true);
    setMessage(null);
    try {
      const amount = parseNumber(budgetText);
      if (amount === null) throw new Error('Enter the monthly budget.');
      await p.save(setBudget(p.portfolio, month, amount));
      setBudgetText(null);
      setMessage({ text: 'Budget saved.', error: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not save the budget.', error: true });
    } finally {
      setSavingBudget(false);
    }
  }

  const arrow = (dir: -1 | 1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dir < 0 ? 'Previous month' : 'Next month'}
      onPress={() => setMonth(shiftMonth(month, dir))}
      hitSlop={10}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.cardRaised, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Icon name={dir < 0 ? 'chevronLeft' : 'chevronRight'} size={18} color={colors.foreground} />
    </Pressable>
  );
  const spentFraction = plan && plan.budget > 0 ? plan.already / plan.budget : 0;

  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Header title="Monthly SIP" subtitle="Split this month's money across your targets" />
      <View style={styles.row}>
        {arrow(-1)}
        <Text style={styles.strong}>{monthLabel}</Text>
        {arrow(1)}
      </View>
      {message ? <Notice tone={message.error ? 'error' : 'warn'}>{message.text}</Notice> : null}
      {result.error ? <Notice tone="error">{result.error}</Notice> : null}

      {plan ? (
        <Card tone="hero">
          <View style={styles.row}>
            <Stat label="Budget">
              <Text style={styles.strong}>{moneyShort(plan.budget)}</Text>
            </Stat>
            <Stat label="Invested">
              <Text style={styles.strong}>{moneyShort(plan.already)}</Text>
            </Stat>
            <Stat label="Remaining">
              <Text style={styles.strong}>{moneyShort(plan.remaining)}</Text>
            </Stat>
          </View>
          <ProgressBar fraction={spentFraction} tone={spentFraction >= 1 ? colors.success : colors.primary} />
          <View style={styles.divider} />
          <View style={[styles.row, { alignItems: 'flex-end' }]}>
            <View style={{ flex: 1 }}>
              <Input
                label="This month's budget (PKR)"
                value={budgetText ?? String(plan.budget)}
                onChangeText={setBudgetText}
                keyboardType="decimal-pad"
              />
            </View>
            <Button label="Save" disabled={budgetText === null} loading={savingBudget} onPress={() => void saveBudget()} style={{ minHeight: 48 }} />
          </View>
          <View style={[styles.row, { alignItems: 'flex-end' }]}>
            <View style={{ flex: 1 }}>
              <Input label="Fee estimate (%)" value={fee} onChangeText={setFee} keyboardType="decimal-pad" />
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6, paddingBottom: 8 }}>
              <Text style={styles.statLabel}>Use older quotes</Text>
              <Switch value={allowOld} onValueChange={setAllowOld} trackColor={{ true: colors.primary }} />
            </View>
          </View>
        </Card>
      ) : null}

      <Pressable
        onPress={() => router.push('/picks')}
        style={({ pressed }) => [styles.row, { backgroundColor: colors.primarySoft, borderRadius: 14, padding: 14, opacity: pressed ? 0.75 : 1 }]}
      >
        <Icon name="sparkle" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontWeight: '600' }}>Get Monthly Picks</Text>
          <Muted>AI-ranked ideas from your shortlist</Muted>
        </View>
        <Icon name="chevronRight" size={16} color={colors.primary} />
      </Pressable>

      {plan && plan.errors.length ? <Notice>{plan.errors.join('\n')}</Notice> : null}

      {plan && !plan.errors.length ? (
        <>
          <SectionLabel>Suggested buys</SectionLabel>
          <Muted>
            Whole shares at the latest saved prices. Invested {money(plan.invested)}, leftover {money(plan.leftover)}.
          </Muted>
          {plan.rows.map((r) => (
            <Card key={r.ticker}>
              <View style={styles.row}>
                <Avatar ticker={r.ticker} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.strong}>{r.ticker}</Text>
                  <Muted>{r.name}</Muted>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.strong}>{r.shares > 0 ? `${r.shares} shares` : '—'}</Text>
                  <Muted>{r.amount > 0 ? money(r.amount) : r.reason}</Muted>
                </View>
              </View>
              <View style={{ gap: 6 }}>
                <ProgressBar fraction={r.target > 0 ? r.currentWeight / r.target : 0} tone={r.currentWeight > r.target ? colors.warn : colors.primary} />
                <Muted>
                  Now {r.currentWeight.toFixed(1)}% of {r.target}% target · price {r.price === null ? '—' : money(r.price)}
                </Muted>
              </View>
              {r.shares > 0 && r.price !== null ? (
                <Button
                  label="Record this buy"
                  variant="secondary"
                  icon="check"
                  onPress={() =>
                    router.push({
                      pathname: '/transaction',
                      params: { ticker: r.ticker, kind: 'buy', shares: String(r.shares), price: String(r.price), month },
                    })
                  }
                />
              ) : null}
            </Card>
          ))}
          {plan.rows.length === 0 ? (
            <EmptyState icon="calendar" title="No targets yet" body="Set target weights for your companies on the web app, then come back for a plan." />
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
