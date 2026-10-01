import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { money } from '@shared/portfolio.ts';
import { estimateMonthlyPicks, type MonthlyPicksResearch } from '@shared/monthly-picks.ts';
import { useAuth } from '@/auth/AuthProvider';
import { parseNumber } from '@/data/mutations';
import { currentMonth } from '@/data/sip';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Card, Muted, Notice, Screen, Title, styles } from '@/ui/kit';

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
const MAX = 15;

export default function Picks() {
  const { api } = useAuth();
  const p = usePortfolio();
  const qc = useQueryClient();
  const month = currentMonth();
  const [shortlist, setShortlist] = useState<string[] | null>(null);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0');
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portfolio = p.portfolio;
  const selected =
    shortlist ??
    (portfolio
      ? (portfolio.monthlyPicksShortlist?.length
          ? portfolio.monthlyPicksShortlist
          : portfolio.companies.filter((c) => c.target > 0).map((c) => c.ticker)
        ).slice(0, MAX)
      : []);

  // Resume the latest run (or pick up one that's still going) when the screen opens.
  const latest = useQuery({
    queryKey: ['recommendations'],
    queryFn: () => api.get<{ recommendations: Run[] }>('/api/recommendations'),
  });
  useEffect(() => {
    if (runId || !latest.data) return;
    const first = latest.data.recommendations[0];
    if (first && first.month === month) setRunId(first.id);
  }, [latest.data, runId, month]);

  const run = useQuery({
    queryKey: ['recommendation', runId],
    enabled: Boolean(runId),
    queryFn: () => api.get<Run>(`/api/recommendations?id=${runId}`),
    refetchInterval: (q) => (q.state.data && ACTIVE.includes(q.state.data.status) ? 4000 : false),
  });
  const current = run.data ?? null;

  const rows = useMemo(() => {
    if (!portfolio || !current?.result || current.status !== 'completed') return [];
    try {
      return estimateMonthlyPicks(current.result, portfolio, current.amount, current.feePct);
    } catch {
      return [];
    }
  }, [portfolio, current]);

  if (p.isLoading || !portfolio)
    return (
      <Screen edges={['bottom']}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      </Screen>
    );

  const budget = amount || String(portfolio.budgets[month] ?? 100000);

  async function start(rerun: boolean) {
    setError(null);
    setStarting(true);
    try {
      const amt = parseNumber(budget);
      if (amt === null) throw new Error('Enter the amount to invest.');
      if (!selected.length) throw new Error('Choose at least one company.');
      const started = await api.post<Run>('/api/recommendations', {
        month,
        amount: amt,
        feePct: parseNumber(fee) ?? 0,
        shortlist: selected,
        rerun,
      });
      qc.setQueryData(['recommendation', started.id], started);
      setRunId(started.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the research.');
    } finally {
      setStarting(false);
    }
  }

  const active = current !== null && ACTIVE.includes(current.status);
  const toggle = (t: string) =>
    setShortlist(selected.includes(t) ? selected.filter((x) => x !== t) : selected.length < MAX ? [...selected, t] : selected);

  return (
    <Screen edges={['bottom']} onRefresh={() => void run.refetch()} refreshing={run.isRefetching}>
      <Title>Monthly Picks</Title>
      <Muted>Ranks the companies you choose and suggests how to split this month's money. Not financial advice.</Muted>
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card>
        <Text style={styles.statLabel}>Companies to consider ({selected.length}/{MAX})</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {portfolio.companies.map((c) => {
            const on = selected.includes(c.ticker);
            return (
              <Pressable
                key={c.ticker}
                onPress={() => toggle(c.ticker)}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }}
              >
                <Text style={{ color: on ? '#fff' : colors.foreground }}>{c.ticker}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.statLabel}>Amount (PKR)</Text>
            <TextInput
              style={{ backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, color: colors.foreground, fontSize: 16, marginTop: 4 }}
              value={budget}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.statLabel}>Fee estimate (%)</Text>
            <TextInput
              style={{ backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 10, color: colors.foreground, fontSize: 16, marginTop: 4 }}
              value={fee}
              onChangeText={setFee}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <Pressable style={[styles.button, (starting || active) && { opacity: 0.4 }]} disabled={starting || active} onPress={() => void start(current?.status === 'completed')}>
          <Text style={styles.buttonText}>{current?.status === 'completed' ? 'Run again' : 'Get picks'}</Text>
        </Pressable>
      </Card>

      {active ? (
        <Card>
          <View style={[styles.row, { justifyContent: 'flex-start', gap: 10 }]}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.strong}>{current.status === 'gathering' ? 'Gathering company data' : 'Ranking'}</Text>
          </View>
          <Muted>
            {current.progress?.pending?.length ? `Waiting on ${current.progress.pending.join(', ')}. ` : ''}
            This can take a few minutes. You can leave this screen and come back.
          </Muted>
        </Card>
      ) : null}

      {current?.status === 'failed' ? <Notice tone="error">{current.error ?? 'The run failed. Try again.'}</Notice> : null}

      {current?.status === 'completed' && current.result ? (
        <>
          {current.method === 'quant' ? (
            <Notice>{current.result.fallbackReason ?? 'Ranked by the numbers only (no AI commentary).'}</Notice>
          ) : null}
          <Card>
            <Text style={styles.strong}>Market outlook</Text>
            <Muted>{current.result.marketOutlook}</Muted>
          </Card>
          {rows.map((r) => (
            <Card key={r.ticker}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.strong}>{r.ticker} · {r.allocationPct}%</Text>
                  <Muted>{r.name} · {r.confidence} confidence</Muted>
                </View>
                <Text style={styles.strong}>{money(r.allocationPkr)}</Text>
              </View>
              <Text style={{ color: colors.foreground }}>{r.thesis}</Text>
              {r.risks.length ? <Muted>Risks: {r.risks.join('; ')}</Muted> : null}
              {r.shares !== null && r.price !== null ? (
                <>
                  <Muted>
                    About {r.shares} shares at {money(r.price)}; spend {money(r.estimatedSpend ?? 0)}.
                  </Muted>
                  {r.shares > 0 ? (
                    <Pressable
                      style={styles.button}
                      onPress={() =>
                        router.push({
                          pathname: '/transaction',
                          params: { ticker: r.ticker, kind: 'buy', shares: String(r.shares), price: String(r.price), month },
                        })
                      }
                    >
                      <Text style={styles.buttonText}>Record this buy</Text>
                    </Pressable>
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
