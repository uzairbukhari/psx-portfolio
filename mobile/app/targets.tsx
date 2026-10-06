import { ChoosePortfolio } from '@/ui/AllPortfolios';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { WEIGHT_CAP, round, today } from '@shared/portfolio.ts';
import { applyTargets, evenWeights, screenStatus, targetRows, targetTotals } from '@shared/targets.ts';
import { isIsoDate, parseNumber } from '@/data/mutations';
import { searchCompanies } from '@/data/picks';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { Icon } from '@/ui/Icon';
import { Avatar, Button, Card, Input, Loading, Muted, Notice, SectionLabel, StatusChip, useKitStyles } from '@/ui/kit';

type Draft = { ticker: string; weight: string; approved: boolean; screenDate: string };

const weightOf = (text: string) => parseNumber(text) ?? 0;
const bump = (text: string, delta: number) => String(Math.min(100, Math.max(0, round(weightOf(text) + delta))));

function Step({ label, glyph, onPress }: { label: string; glyph: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
    >
      <Text style={{ color: colors.ink, fontSize: 22, lineHeight: 26 }}>{glyph}</Text>
    </Pressable>
  );
}

/** Choose the companies the monthly SIP buys and their target weights (must total 100%). */
export default function Targets() {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const p = usePortfolio();
  const [rows, setRows] = useState<Draft[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const portfolio = p.portfolio;

  const draft: Draft[] =
    rows ??
    (portfolio ? targetRows(portfolio).map((r) => ({ ticker: r.ticker, weight: String(r.target), approved: r.approved, screenDate: r.screenDate })) : []);
  const edit = (next: Draft[]) => setRows(next);
  const patch = (ticker: string, change: Partial<Draft>) => edit(draft.map((r) => (r.ticker === ticker ? { ...r, ...change } : r)));

  if (p.isAll) return <ChoosePortfolio purpose="Choose the portfolio whose targets you want to edit." />;
  if (p.isLoading || !portfolio)
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Targets' }} />
        <Loading />
      </SafeAreaView>
    );

  const totals = targetTotals(draft.map((r) => ({ ticker: r.ticker, target: weightOf(r.weight) })));
  const names = new Map(portfolio.companies.map((c) => [c.ticker, c.name]));
  const available = searchCompanies(portfolio.companies.filter((c) => !draft.some((r) => r.ticker === c.ticker)), query);
  const badTone = totals.status === 'exact' ? 'success' : totals.status === 'over' ? 'danger' : 'warn';

  async function save() {
    if (!portfolio) return;
    if (p.locked) {setError('This portfolio is locked. Unlock it in Settings → Portfolios.');return;}
    setError(null);
    try {
      for (const r of draft)
        if (r.screenDate && !isIsoDate(r.screenDate)) throw new Error(`Enter ${r.ticker}'s screening date as YYYY-MM-DD, or leave it blank.`);
      const next = applyTargets(
        portfolio,
        draft.map((r) => ({ ticker: r.ticker, target: weightOf(r.weight), approved: r.approved, screenDate: r.screenDate })),
      );
      setBusy(true);
      await p.save(next);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the targets.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Targets' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 56 : 0}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <Muted>
            Each month's money goes first to the companies furthest below their target. Weights must add up to 100%. A company can reach at most {WEIGHT_CAP}% of
            the portfolio after this month's money, so weights above {WEIGHT_CAP}% are treated as {WEIGHT_CAP}%.
          </Muted>

          <Card>
            <View style={styles.row} accessible accessibilityLiveRegion="polite">
              <Text style={styles.strong}>Total {totals.total}%</Text>
              <StatusChip
                text={totals.status === 'exact' ? 'Ready to save' : totals.status === 'over' ? `${-totals.remaining}% over` : `${totals.remaining}% to go`}
                tone={badTone}
              />
            </View>
            {totals.overCap.length ? (
              <Muted>
                {totals.overCap.join(', ')} {totals.overCap.length === 1 ? 'is' : 'are'} above {WEIGHT_CAP}%; the plan counts {totals.overCap.length === 1 ? 'it' : 'them'} as {WEIGHT_CAP}%.
              </Muted>
            ) : null}
          </Card>

          {draft.length === 0 ? <Muted>No companies yet. Add the ones you want the monthly SIP to buy.</Muted> : null}
          {draft.map((r) => {
            const status = screenStatus({ approved: r.approved, screenDate: r.screenDate });
            return (
              <Card key={r.ticker}>
                <View style={styles.row}>
                  <Avatar ticker={r.ticker} size={36} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.strong}>{r.ticker}</Text>
                    <Muted>{names.get(r.ticker)}</Muted>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${r.ticker} from targets`}
                    onPress={() => edit(draft.filter((x) => x.ticker !== r.ticker))}
                    hitSlop={10}
                    style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Icon name="close" size={20} color={colors.muted} />
                  </Pressable>
                </View>
                <View style={[styles.row, { justifyContent: 'center' }]}>
                  <Step label={`Decrease ${r.ticker} target`} glyph="−" onPress={() => patch(r.ticker, { weight: bump(r.weight, -1) })} />
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Target weight (%)"
                      value={r.weight}
                      onChangeText={(weight) => patch(r.ticker, { weight })}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 15"
                    />
                  </View>
                  <Step label={`Increase ${r.ticker} target`} glyph="+" onPress={() => patch(r.ticker, { weight: bump(r.weight, 1) })} />
                </View>
                <View style={[styles.row, { alignItems: 'flex-end' }]}>
                  <View style={{ flex: 1 }}>
                    <Input
                      label="Screening effective date"
                      hint="YYYY-MM-DD"
                      value={r.screenDate}
                      onChangeText={(screenDate) => patch(r.ticker, { screenDate })}
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={10}
                    />
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6, paddingBottom: 22 }}>
                    <Text style={styles.statLabel}>New buys</Text>
                    <Switch
                      accessibilityLabel={`Enable new SIP purchases for ${r.ticker}`}
                      value={r.approved}
                      onValueChange={(approved) => patch(r.ticker, { approved })}
                      trackColor={{ true: colors.primary, false: colors.line }}
                      thumbColor={colors.surface}
                    />
                  </View>
                </View>
                <Text style={[styles.muted, status.state !== 'valid' && { color: colors.warn }]}>{status.label}</Text>
              </Card>
            );
          })}

          <SectionLabel>Add a company</SectionLabel>
          {adding ? (
            <Card>
              <Input label="Search your companies" value={query} onChangeText={setQuery} placeholder="Ticker or name" autoCapitalize="none" autoCorrect={false} />
              {available.slice(0, 8).map((c) => (
                <Pressable
                  key={c.ticker}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${c.ticker} to targets`}
                  onPress={() => {
                    edit([...draft, { ticker: c.ticker, weight: '', approved: false, screenDate: '' }]);
                    setQuery('');
                    setAdding(false);
                  }}
                  style={({ pressed }) => [styles.row, { paddingVertical: 8, opacity: pressed ? 0.6 : 1 }]}
                >
                  <Avatar ticker={c.ticker} size={32} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.strong}>{c.ticker}</Text>
                    <Muted>{c.name}</Muted>
                  </View>
                  <Icon name="plus" size={18} color={colors.primary} />
                </Pressable>
              ))}
              {available.length === 0 ? <Muted>No other company matches. A company that is not in your portfolio yet is added by recording a transaction for it.</Muted> : null}
              {available.length > 8 ? <Muted>Showing 8 of {available.length}. Type to narrow the list.</Muted> : null}
              <Button label="Cancel" variant="text" onPress={() => { setAdding(false); setQuery(''); }} />
            </Card>
          ) : (
            <Button label="Add company" variant="outline" icon="plus" onPress={() => setAdding(true)} />
          )}
          {draft.length >= 2 ? (
            <Button
              label="Spread evenly"
              variant="text"
              onPress={() => {
                const weights = evenWeights(draft.length);
                edit(draft.map((r, i) => ({ ...r, weight: String(weights[i]) })));
              }}
            />
          ) : null}

          <Muted>A screen older than 183 days pauses new buys for that company until you renew its date. Today is {today()}.</Muted>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button label="Save targets" icon="check" loading={busy} disabled={p.locked || totals.status !== 'exact'} onPress={() => void save()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
