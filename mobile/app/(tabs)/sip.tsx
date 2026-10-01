import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { money, moneyShort } from '@shared/portfolio.ts';
import { parseNumber } from '@/data/mutations';
import { buildPlan, currentMonth, setBudget, shiftMonth } from '@/data/sip';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Card, Muted, Notice, Screen, Stat, Title, styles } from '@/ui/kit';

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
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </Screen>
    );
  if (!p.portfolio || !result)
    return (
      <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
        <Notice tone="error">{p.error?.message ?? 'Could not load your portfolio.'}</Notice>
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

  return (
    <Screen onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Title>Monthly SIP</Title>
      <View style={styles.row}>
        <Pressable onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={12}>
          <Text style={{ color: colors.primary, fontSize: 22 }}>‹</Text>
        </Pressable>
        <Text style={styles.strong}>{monthLabel}</Text>
        <Pressable onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={12}>
          <Text style={{ color: colors.primary, fontSize: 22 }}>›</Text>
        </Pressable>
      </View>
      {message ? <Notice tone={message.error ? 'error' : 'warn'}>{message.text}</Notice> : null}
      {result.error ? <Notice tone="error">{result.error}</Notice> : null}

      {plan ? (
        <Card>
          <View style={styles.row}>
            <Stat label="Budget">
              <Text style={styles.strong}>{moneyShort(plan.budget)}</Text>
            </Stat>
            <Stat label="Already invested">
              <Text style={styles.strong}>{moneyShort(plan.already)}</Text>
            </Stat>
            <Stat label="Remaining">
              <Text style={styles.strong}>{moneyShort(plan.remaining)}</Text>
            </Stat>
          </View>
          <View style={styles.divider} />
          <Text style={styles.statLabel}>Change this month's budget (PKR)</Text>
          <View style={[styles.row, { gap: 8 }]}>
            <TextInput
              style={{ flex: 1, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, color: colors.foreground, fontSize: 16 }}
              value={budgetText ?? String(plan.budget)}
              onChangeText={setBudgetText}
              keyboardType="decimal-pad"
            />
            <Pressable
              style={[styles.button, { paddingHorizontal: 18 }, (budgetText === null || savingBudget) && { opacity: 0.4 }]}
              disabled={budgetText === null || savingBudget}
              onPress={() => void saveBudget()}
            >
              <Text style={styles.buttonText}>Save</Text>
            </Pressable>
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.statLabel}>Fee estimate (%)</Text>
              <TextInput
                style={{ backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, color: colors.foreground, fontSize: 16, marginTop: 4 }}
                value={fee}
                onChangeText={setFee}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Text style={styles.statLabel}>Use older quotes</Text>
              <Switch value={allowOld} onValueChange={setAllowOld} trackColor={{ true: colors.primary }} />
            </View>
          </View>
        </Card>
      ) : null}

      {plan && plan.errors.length ? (
        <Notice>
          {plan.errors.join('\n')}
        </Notice>
      ) : null}

      {plan && !plan.errors.length ? (
        <>
          <Muted>
            Suggested buys use whole shares at the latest saved prices. Invested {money(plan.invested)}, leftover {money(plan.leftover)}.
          </Muted>
          {plan.rows.map((r) => (
            <Card key={r.ticker}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.strong}>{r.ticker}</Text>
                  <Muted>{r.name}</Muted>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.strong}>{r.shares > 0 ? `${r.shares} shares` : '—'}</Text>
                  <Muted>{r.amount > 0 ? money(r.amount) : r.reason}</Muted>
                </View>
              </View>
              <Muted>
                Now {r.currentWeight.toFixed(1)}% · target {r.target}% · price {r.price === null ? '—' : money(r.price)}
              </Muted>
              {r.shares > 0 && r.price !== null ? (
                <Pressable
                  style={styles.secondary}
                  onPress={() =>
                    router.push({
                      pathname: '/transaction',
                      params: { ticker: r.ticker, kind: 'buy', shares: String(r.shares), price: String(r.price), month },
                    })
                  }
                >
                  <Text style={styles.secondaryText}>Record this buy</Text>
                </Pressable>
              ) : null}
            </Card>
          ))}
          {plan.rows.length === 0 ? <Muted>No companies have a target weight yet. Set targets on the web app.</Muted> : null}
        </>
      ) : null}
    </Screen>
  );
}
