import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { money, moneyShort } from '@shared/portfolio.ts';
import { portfolioReport } from '@shared/portfolio-reports.ts';
import { usePortfolio } from '@/data/usePortfolio';
import { colors } from '@/theme/tokens';
import { Card, Header, Loading, Muted, Notice, ProgressBar, Screen, SectionLabel, styles } from '@/ui/kit';

function Bar({ label, value, fraction, tone }: { label: string; value: string; fraction: number; tone?: string }) {
  return (
    <View style={{ marginTop: 8, gap: 5 }}>
      <View style={styles.row}>
        <Text style={{ color: colors.foreground, fontSize: 14 }}>{label}</Text>
        <Text style={{ color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] }}>{value}</Text>
      </View>
      <ProgressBar fraction={fraction} tone={tone} />
    </View>
  );
}

const pct = (n: number | null, digits = 1) => (n === null ? '—' : `${n.toFixed(digits)}%`);

export default function Reports() {
  const p = usePortfolio();
  const built = useMemo(() => {
    if (!p.portfolio) return null;
    try {
      return { report: portfolioReport(p.portfolio), error: null };
    } catch (e) {
      return { report: null, error: e instanceof Error ? e.message : 'Could not build the reports.' };
    }
  }, [p.portfolio]);

  if (p.isLoading)
    return (
      <Screen edges={['bottom']}>
        <Loading />
      </Screen>
    );
  if (!built?.report)
    return (
      <Screen edges={['bottom']}>
        <Notice tone="error">{built?.error ?? p.error?.message ?? 'Could not load your portfolio.'}</Notice>
      </Screen>
    );
  const r = built.report;
  const s = r.summary;
  const maxAlloc = Math.max(...r.companyAllocation.map((a) => a.weight), 1);
  const lastMonths = r.monthlyActivity.slice(-6);
  const maxMonth = Math.max(...lastMonths.map((m) => m.invested), 1);

  return (
    <Screen edges={['bottom']} onRefresh={() => void p.refetch()} refreshing={p.isRefetching}>
      <Header title="Reports" subtitle="Based on your saved prices and ledger" />
      <Card tone="hero">
        <View style={styles.row}>
          <View>
            <Text style={styles.statLabel}>Priced value</Text>
            <Text style={styles.strong}>{moneyShort(s.pricedValue)}</Text>
          </View>
          <View>
            <Text style={styles.statLabel}>Gain</Text>
            <Text style={styles.strong}>
              {s.totalGain === null ? '—' : `${moneyShort(s.totalGain)} (${pct(s.totalGainPercent)})`}
            </Text>
          </View>
        </View>
        <Muted>
          Quotes for {s.quoteCoverage.priced} of {s.quoteCoverage.held} holdings. Top three are {pct(s.topThreeWeight, 0)} of value.
          {s.largestSector ? ` Largest sector: ${s.largestSector.sector} (${pct(s.largestSector.weight, 0)}).` : ''}
        </Muted>
      </Card>

      <Card>
        <SectionLabel>Allocation</SectionLabel>
        {r.companyAllocation.map((a) => (
          <Bar key={a.ticker} label={a.ticker} value={pct(a.weight)} fraction={a.weight / maxAlloc} />
        ))}
      </Card>

      <Card>
        <SectionLabel>Sectors</SectionLabel>
        {r.sectorAllocation.map((a) => (
          <Bar key={a.sector} label={a.sector} value={pct(a.weight)} fraction={a.weight / 100} />
        ))}
      </Card>

      {r.targetComparison.some((t) => t.target > 0) ? (
        <Card>
          <SectionLabel>Actual vs target</SectionLabel>
          {r.targetComparison
            .filter((t) => t.target > 0)
            .map((t) => (
              <View key={t.ticker} style={[styles.row, { marginTop: 6 }]}>
                <Text style={{ color: colors.foreground }}>{t.ticker}</Text>
                <Text style={{ color: colors.foreground }}>
                  {pct(t.actual)} / {pct(t.target)}
                </Text>
              </View>
            ))}
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Gain by company</SectionLabel>
        {r.performance.map((a) => (
          <View key={a.ticker} style={[styles.row, { marginTop: 6 }]}>
            <Text style={{ color: colors.foreground }}>{a.ticker}</Text>
            <Text style={{ color: a.gain >= 0 ? colors.success : colors.danger }}>
              {money(a.gain)} ({pct(a.gainPercent)})
            </Text>
          </View>
        ))}
      </Card>

      {lastMonths.length ? (
        <Card>
          <SectionLabel>Invested, last {lastMonths.length} months</SectionLabel>
          {lastMonths.map((m) => (
            <Bar key={m.month} label={m.month} value={moneyShort(m.invested)} fraction={m.invested / maxMonth} />
          ))}
        </Card>
      ) : null}

      <Card>
        <SectionLabel>Realized</SectionLabel>
        <Muted>
          Gains {money(r.realized.totalRealizedGain)}. Dividends (gross) {money(r.realized.totalDividendIncomeGross)}.
          {r.realized.totalCapitalGainsTax !== null ? ` Capital gains tax ${money(r.realized.totalCapitalGainsTax)}.` : ''}
          {r.realized.taxProfileSet ? '' : ' Set your tax profile on the website for tax estimates.'}
        </Muted>
      </Card>
    </Screen>
  );
}
