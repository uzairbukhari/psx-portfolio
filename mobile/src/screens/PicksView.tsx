import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { money } from '@shared/portfolio.ts';
import type { PublicAnalysisResponse } from '@shared/api-types.ts';
import { parsePublicAnalysis, pollIntervalMs } from '@shared/api-validate.ts';
import { watchQuery } from '@shared/market-watch.ts';
import { heldValues, recordRun, type StoredPicksRun } from '@shared/picks-local.ts';
import { executePicksRun } from '@shared/picks-run.ts';
import type { RunProgress } from '@shared/monthly-picks-progress.ts';
import { portfolioCounts } from '@shared/portfolio-counts.ts';
import { explainSizing } from '@shared/monthly-picks-allocation.ts';
import { PROGRESS_STEPS } from '@shared/monthly-picks-progress.ts';
import { estimateMonthlyPicks, type MonthlyPicksResearch } from '@shared/monthly-picks.ts';
import { useAuth } from '@/auth/AuthProvider';
import { parseNumber } from '@/data/mutations';
import { MAX_SHORTLIST, initialShortlist, pickSources, searchCompanies, withPicksInputs } from '@/data/picks';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { ReviewBuysSheet } from '@/ui/ReviewBuysSheet';
import { Icon } from '@/ui/Icon';
import { Avatar, Button, Card, Chip, Input, Loading, Muted, Notice, SectionLabel, StatusChip, useKitStyles } from '@/ui/kit';

type Run = StoredPicksRun;
const MAX = MAX_SHORTLIST;

/** Where a pick's numbers and thesis came from; each opens in the browser. */
function Sources({ item }: { item: Parameters<typeof pickSources>[0] }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
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
          style={({ pressed }) => [styles.row, { justifyContent: 'flex-start', minHeight: 48, opacity: pressed ? 0.6 : 1 }]}
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

/** Monthly Picks inside Plan: shortlist, amount, run state, results and the shared review-and-record sheet. */
export function PicksView({ month, fee, onFee, readOnly }: { month: string; fee: string; onFee: (v: string) => void; readOnly: boolean }) {
  const styles = useKitStyles();
  const { colors } = useTheme();
  const { api } = useAuth();
  const p = usePortfolio();
  const [reviewing, setReviewing] = useState(false);
  const [shortlist, setShortlist] = useState<string[] | null>(null);
  const [amount, setAmount] = useState('');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const estimateError = useRef<string | null>(null);

  const portfolio = p.portfolio;
  const selected = shortlist ?? (portfolio ? initialShortlist(portfolio) : []);

  // Runs are computed on this phone and kept in the encrypted portfolio; show the newest one for this month.
  const current: Run | null = portfolio?.monthlyPicksRuns?.find((r) => r.month === month) ?? null;

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

  if (p.isLoading || !portfolio) return <Loading cards={2} />;

  const savedBudget = portfolio.budgets[month];
  const budget = amount || (savedBudget === undefined ? '' : String(savedBudget));

  async function start() {
    if (!portfolio) return;
    setError(null);
    setStarting(true);
    try {
      const amt = parseNumber(budget);
      if (amt === null) throw new Error('Enter the amount to invest.');
      if (!selected.length) throw new Error('Choose at least one company.');
      // Remember the shortlist and this month's amount (encrypted, like everything else) so they are here next time.
      const withInputs = withPicksInputs(portfolio, month, selected, amt) ?? portfolio;
      if (withInputs !== portfolio) await p.save(withInputs);
      const { run } = await executePicksRun(
        {
          // Only the tickers go to the server, to read public company data.
          analysis: async (tickers) => {
            const data = await api.get<PublicAnalysisResponse & { dispatchEnabled: boolean }>(`/api/recommendations?${watchQuery(tickers)}`);
            const parsed = parsePublicAnalysis(data);
            if (!parsed) throw new Error('The company data response was not understood.');
            return { ...parsed, dispatchEnabled: Boolean(data.dispatchEnabled) };
          },
          requestFacts: async (tickers) => {
            const out = await api.post<{ waiting: boolean }>('/api/recommendations', { action: 'refresh-facts', tickers });
            return { waiting: Boolean(out.waiting) };
          },
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: () => Date.now(),
          pollMs: pollIntervalMs,
          onProgress: setProgress,
        },
        { month, amount: amt, feePct: parseNumber(fee) ?? 0, shortlist: selected, holdings: heldValues(withInputs) },
      );
      await p.save({ ...withInputs, monthlyPicksRuns: recordRun(withInputs.monthlyPicksRuns, run) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get the picks.');
    } finally {
      setProgress(null);
      setStarting(false);
    }
  }

  const targeted = portfolio.companies.filter((c) => c.target > 0).map((c) => c.ticker);
  const shown = searchCompanies(portfolio.companies, query);
  const active = progress !== null;
  const toggle = (t: string) =>
    setShortlist(selected.includes(t) ? selected.filter((x) => x !== t) : selected.length < MAX ? [...selected, t] : selected);

  return (
    <>
      <Muted>Ranks the companies you choose and suggests how to split this month's money. Not financial advice.</Muted>
      {readOnly ? <Notice tone="info">{month} is in the past, so picks are read only here.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <Card>
        <SectionLabel>Companies to consider · {selected.length}/{MAX}</SectionLabel>
        <Muted>{(() => { const c = portfolioCounts(portfolio, selected); return `${c.savedCompanies} saved · ${c.holdings} held · ${c.shortlisted} shortlisted`; })()}</Muted>
        <Input label="Search companies" value={query} onChangeText={setQuery} placeholder="Ticker or name" autoCapitalize="none" autoCorrect={false} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {targeted.length ? <Chip label="Use target companies" onPress={() => setShortlist(targeted.slice(0, MAX))} /> : null}
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
            <Input label="Fee estimate (%)" value={fee} onChangeText={onFee} keyboardType="decimal-pad" />
          </View>
        </View>
        <Muted>Method: your chosen companies are ranked from public PSX company data and prices, and sized against your holdings, all on this phone. Only the company symbols are sent to look up public data; your amount, holdings and results stay encrypted.</Muted>
        <Button
          label={current?.status === 'completed' ? 'Update picks' : 'Get picks'}
          icon="sparkle"
          loading={starting}
          disabled={active || readOnly}
          onPress={() => void start()}
        />
      </Card>

      {progress ? (
        <Card>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.strong, { textAlign: 'center' }]}>
            {PROGRESS_STEPS.find((s) => s.key === progress.step)?.label ?? 'Working'} · {progress.percent}%
          </Text>
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {progress.total ? `${progress.completed} of ${progress.total} companies gathered. ` : ''}
            {progress.pending.length ? `Waiting on ${progress.pending.join(', ')}. ` : ''}
            {progress.degraded ? 'Continuing with partial evidence. ' : ''}
            {progress.message ? progress.message : ''}
          </Text>
        </Card>
      ) : null}

      {current?.status === 'failed' ? <Notice tone="error">{current.error ?? 'The run failed. Try again.'}</Notice> : null}

      {current?.status === 'completed' && current.result ? (
        <>
          {explainSizing(current.result.sizing).map((line) => <Notice key={line}>{line}</Notice>)}
          <Notice>{current.result.fallbackReason ?? 'Ranked by the numbers only, on this phone (no AI).'}</Notice>
          <Card>
            <Text style={styles.strong}>Market outlook</Text>
            <Text style={styles.text}>{current.result.marketOutlook}</Text>
          </Card>
          {estimateError.current && rows.length === 0 ? <Notice tone="error">{estimateError.current}</Notice> : null}
          <SectionLabel>Top picks</SectionLabel>
          {rows.some((r) => (r.shares ?? 0) > 0 && r.price !== null) && !readOnly ? (
            <Button label="Record these buys…" icon="check" disabled={p.offline} onPress={() => setReviewing(true)} accessibilityHint="Opens a review sheet; nothing is saved until you confirm" />
          ) : null}
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
                  <StatusChip text={`${r.confidence} confidence`} tone={r.confidence === 'High' ? 'success' : r.confidence === 'Low' ? 'warn' : 'neutral'} />
                </View>
              </View>
              <Text style={styles.text}>{r.thesis}</Text>
              {r.evidenceRefs?.length ? <Muted>Evidence: {r.evidenceRefs.map((ref) => `${ref.label} ${ref.value}`).join(' · ')}</Muted> : null}
              {r.risks.length ? <Muted>Risks: {r.risks.join('; ')}</Muted> : null}
              <Sources item={r} />
              {r.shares !== null && r.price !== null ? (
                <>
                  <Muted>
                    About {r.shares} shares at {money(r.price)}; spend {money(r.estimatedSpend ?? 0)}.
                  </Muted>
                  {r.shares > 0 ? (
                    <Button
                      label="Record only this buy"
                      variant="text"
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
          <ReviewBuysSheet visible={reviewing} onClose={() => setReviewing(false)} suggestions={rows} month={month} feePct={parseNumber(fee) ?? 0} title="Record these buys" />
        </>
      ) : null}
    </>
  );
}
