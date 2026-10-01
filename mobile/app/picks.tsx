import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { money } from '@shared/portfolio.ts';
import { estimateMonthlyPicks, type MonthlyPicksResearch } from '@shared/monthly-picks.ts';
import { useAuth, useEmail } from '@/auth/AuthProvider';
import { parseNumber } from '@/data/mutations';
import { MAX_SHORTLIST, initialShortlist, pickSources, searchCompanies, withPicksInputs } from '@/data/picks';
import { currentMonth } from '@/data/sip';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Icon } from '@/ui/Icon';
import { Avatar, Badge, Button, Card, Chip, Header, Input, Loading, Muted, Notice, Screen, SectionLabel, styles } from '@/ui/kit';

type Run = {
  id: string;
  month: string;
  amount: number;
  feePct: number;
  status: string;
  error: string | null;
  result: MonthlyPicksResearch | null;
  method?: 'ai' | 'quant';
  progress?: { phase: 'gathering' | 'ranking'; pending: string[] };
};
const ACTIVE = ['queued', 'gathering', 'in_progress'];
const MAX = MAX_SHORTLIST;

/** Where a pick's numbers and thesis came from; each opens in the browser. */
function Sources({ item }: { item: Parameters<typeof pickSources>[0] }) {
  const sources = pickSources(item);
  if (!sources.length) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.statLabel}>Sources</Text>
      {sources.map((s) => (
        <Pressable
          key={s.url}
          accessibilityRole="link"
          accessibilityLabel={`Open source ${s.title}${s.date ? `, ${s.date}` : ''}`}
          onPress={() => void Linking.openURL(s.url).catch(() => {})}
          style={({ pressed }) => [styles.row, { justifyContent: 'flex-start', minHeight: 44, opacity: pressed ? 0.6 : 1 }]}
        >
          <Icon name="chevronRight" size={14} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: 14, flexShrink: 1 }} numberOfLines={2}>
            {s.title}
            {s.date ? ` · ${s.date}` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function Picks() {
  const { api } = useAuth();
  const email = useEmail();
  const p = usePortfolio();
  const qc = useQueryClient();
  const month = currentMonth();
  const [shortlist, setShortlist] = useState<string[] | null>(null);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0');
  const [query, setQuery] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estimateError = useRef<string | null>(null);

  const portfolio = p.portfolio;
  const selected = shortlist ?? (portfolio ? initialShortlist(portfolio) : []);

  // Resume the latest run (or pick up one that's still going) when the screen opens.
  const latest = useQuery({
    queryKey: ['recommendations', email],
    queryFn: () => api.get<{ recommendations: Run[] }>('/api/recommendations'),
  });
  useEffect(() => {
    if (runId || !latest.data) return;
    const first = latest.data.recommendations[0];
    if (first && first.month === month) setRunId(first.id);
  }, [latest.data, runId, month]);

  const run = useQuery({
    queryKey: ['recommendation', email, runId],
    enabled: Boolean(runId),
    queryFn: () => api.get<Run>(`/api/recommendations?id=${runId}`),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 4000 : false),
  });
  const current = run.data ?? null;

  const rows = useMemo(() => {
    if (!portfolio || !current?.result || current.status !== 'completed') return [];
    estimateError.current = null;
    try {
      return estimateMonthlyPicks(current.result, portfolio, current.amount, current.feePct);
    } catch (e) {
      estimateError.current = e instanceof Error ? e.message : 'Could not work out share counts.';
      return [];
    }
  }, [portfolio, current]);

  if (p.isLoading || !portfolio)
    return (
      <Screen edges={['bottom']}>
        <Loading />
      </Screen>
    );

  const savedBudget = portfolio.budgets[month];
  const budget = amount || (savedBudget === undefined ? '' : String(savedBudget));

  async function start(rerun: boolean) {
    setError(null);
    setStarting(true);
    try {
      const amt = parseNumber(budget);
      if (amt === null) throw new Error('Enter the amount to invest.');
      if (!selected.length) throw new Error('Choose at least one company.');
      // Remember the shortlist and this month's amount, as the web does, so they are here next time (and on the web).
      const withInputs = portfolio ? withPicksInputs(portfolio, month, selected, amt) : null;
      if (withInputs) await p.save(withInputs);
      const started = await api.post<Run>('/api/recommendations', {
        month,
        amount: amt,
        feePct: parseNumber(fee) ?? 0,
        shortlist: selected,
        rerun,
      });
      qc.setQueryData(['recommendation', email, started.id], started);
      setRunId(started.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the research.');
    } finally {
      setStarting(false);
    }
  }

  const targeted = portfolio.companies.filter((c) => c.target > 0).map((c) => c.ticker);
  const shown = searchCompanies(portfolio.companies, query);
  const active = current !== null && ACTIVE.includes(current.status);
  const toggle = (t: string) =>
    setShortlist(selected.includes(t) ? selected.filter((x) => x !== t) : selected.length < MAX ? [...selected, t] : selected);

  return (
    <Screen edges={['bottom']} onRefresh={() => void run.refetch()} refreshing={run.isRefetching}>
      <Header title="Monthly Picks" subtitle="Ranks the companies you choose and suggests how to split this month's money. Not financial advice." />
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card>
        <SectionLabel>Companies to consider · {selected.length}/{MAX}</SectionLabel>
        <Input label="Search companies" value={query} onChangeText={setQuery} placeholder="Ticker or name" autoCapitalize="none" autoCorrect={false} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {targeted.length ? <Chip label="Target holdings" onPress={() => setShortlist(targeted.slice(0, MAX))} /> : null}
          <Chip label="Clear" onPress={() => setShortlist([])} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {shown.map((c) => (
            <Chip key={c.ticker} label={c.ticker} selected={selected.includes(c.ticker)} onPress={() => toggle(c.ticker)} />
          ))}
        </View>
        {shown.length === 0 ? <Muted>No company matches that search.</Muted> : null}
        <Muted>Your shortlist and amount are saved when you get picks.</Muted>
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Input
              label="Amount (PKR)"
              value={budget}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="e.g. 100000"
              hint={budget === '' ? 'Not set. Enter this month\'s budget.' : undefined}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Fee estimate (%)" value={fee} onChangeText={setFee} keyboardType="decimal-pad" />
          </View>
        </View>
        <Button
          label={current?.status === 'completed' ? 'Update picks' : 'Get picks'}
          icon="sparkle"
          loading={starting}
          disabled={active}
          onPress={() => void start(false)}
        />
        {current?.status === 'completed' ? (
          <>
            <Button label="Run fresh research" variant="secondary" icon="refresh" disabled={starting || active} onPress={() => void start(true)} />
            <Muted>Same amount, fee and companies reuse the saved result. Fresh research ignores it and uses AI budget.</Muted>
          </>
        ) : null}
      </Card>

      {active ? (
        <Card>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.strong, { textAlign: 'center' }]}>{current.status === 'gathering' ? 'Gathering company data' : 'Ranking your shortlist'}</Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {current.progress?.pending?.length ? `Waiting on ${current.progress.pending.join(', ')}. ` : ''}
            This can take a few minutes. You can leave this screen and come back.
          </Text>
        </Card>
      ) : null}

      {current?.status === 'failed' ? <Notice tone="error">{current.error ?? 'The run failed. Try again.'}</Notice> : null}

      {current?.status === 'completed' && current.result ? (
        <>
          {current.method === 'quant' ? <Notice>{current.result.fallbackReason ?? 'Ranked by the numbers only (no AI commentary).'}</Notice> : null}
          <Card>
            <Text style={styles.strong}>Market outlook</Text>
            <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 21 }}>{current.result.marketOutlook}</Text>
          </Card>
          {estimateError.current && rows.length === 0 ? <Notice tone="error">{estimateError.current}</Notice> : null}
          <SectionLabel>Top picks</SectionLabel>
          {rows.map((r) => (
            <Card key={r.ticker}>
              <View style={styles.row}>
                <Avatar ticker={r.ticker} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.strong}>{r.ticker} · {r.allocationPct}%</Text>
                  <Muted>{r.name}</Muted>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={[styles.strong, { fontVariant: ['tabular-nums'] }]}>{money(r.allocationPkr)}</Text>
                  <Badge text={`${r.confidence} confidence`} tone={r.confidence === 'High' ? 'success' : r.confidence === 'Low' ? 'warn' : 'neutral'} />
                </View>
              </View>
              <Text style={{ color: colors.foreground, fontSize: 14, lineHeight: 21 }}>{r.thesis}</Text>
              {r.risks.length ? <Muted>Risks: {r.risks.join('; ')}</Muted> : null}
              <Sources item={r} />
              {r.shares !== null && r.price !== null ? (
                <>
                  <Muted>
                    About {r.shares} shares at {money(r.price)}; spend {money(r.estimatedSpend ?? 0)}.
                  </Muted>
                  {r.shares > 0 ? (
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
                </>
              ) : (
                <Muted>No recent saved price, so no share estimate. Enter a price on the company page.</Muted>
              )}
            </Card>
          ))}
          {current.result.unallocatedPct > 0 ? <Muted>{current.result.unallocatedPct}% is left unallocated.</Muted> : null}
        </>
      ) : null}
    </Screen>
  );
}
