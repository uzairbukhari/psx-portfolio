import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { money, moneyShort } from '@shared/portfolio.ts';
import { portfolioReport } from '@shared/portfolio-reports.ts';
import { signedAmountLabel, signedPercentLabel } from '@/data/a11y';
import { signedMoney, signedPercent } from '@/data/format';
import { usePortfolio } from '@/data/usePortfolio';
import { useTheme } from '@/theme/ThemeProvider';
import { BenchmarkCard, MoneyWeightedReturnCard, ValueVsMoneyInCard } from '@/ui/TrackRecordCards';
import { Amount, Card, Collapsible, Loading, Muted, Notice, ProgressBar, Stat, useKitStyles } from '@/ui/kit';

function Bar({ label, value, fraction, tone }: { label: string; value: string; fraction: number; tone?: string }) {
  const styles = useKitStyles();
  return (
    <View style={{ marginTop: 6, gap: 5 }} accessible accessibilityRole="text" accessibilityLabel={`${label}, ${value}`}>
      <View style={styles.row}>
        <Text style={[styles.text, { flexShrink: 1 }]}>{label}</Text>
        <Text style={styles.muted}>{value}</Text>
      </View>
      <ProgressBar fraction={fraction} tone={tone} />
    </View>
  );
}

const pct = (n: number | null, digits = 1) => (n === null ? '—' : `${n.toFixed(digits)}%`);

/** Insights segment of Portfolio: the report sections, each collapsible with a "how this is calculated" note. */
export function Insights() {
  const p = usePortfolio();
  const styles = useKitStyles();
  const { colors } = useTheme();
  const built = useMemo(() => {
    if (!p.portfolio) return null;
    try {
      return { report: portfolioReport(p.portfolio), error: null };
    } catch (e) {
      return { report: null, error: e instanceof Error ? e.message : 'Could not build the reports.' };
    }
  }, [p.portfolio]);

  if (p.isLoading) return <Loading cards={2} />;
  if (!built?.report) return <Notice tone="error">{built?.error ?? p.error?.message ?? 'Could not load your portfolio.'}</Notice>;
  const r = built.report;
  const s = r.summary;
  const maxAlloc = Math.max(...r.companyAllocation.map((a) => a.weight), 1);
  const lastMonths = r.monthlyActivity.slice(-6);
  const maxMonth = Math.max(...lastMonths.map((m) => m.invested), 1);

  return (
    <>
      <Card tone="hero">
        <View style={styles.row}>
          <Stat label="Market value of priced holdings">
            <Text style={styles.number}>{moneyShort(s.pricedValue)}</Text>
          </Stat>
          <Stat label="Unrealised gain">
            {s.totalGain === null ? (
              <Text style={styles.number} accessibilityLabel="Unrealised gain not yet known">Not yet known</Text>
            ) : (
              <Amount value={s.totalGain} text={`${signedMoney(s.totalGain)} (${signedPercent(s.totalGainPercent)})`} label="Unrealised" />
            )}
          </Stat>
        </View>
        <View style={{ gap: 2 }}>
          <Text style={styles.statLabel}>Total return</Text>
          {s.grandTotalReturn === null ? (
            <Text style={styles.number} accessibilityLabel="Total return not yet known">Not yet known</Text>
          ) : (
            <Amount value={s.grandTotalReturn} label="Total return" size={17} weight="700" />
          )}
          <Muted>Unrealised gain plus realised gains and dividends received, after estimated tax. Shown as not yet known when a price or cost is missing.</Muted>
        </View>
        <Muted>
          Quotes for {s.quoteCoverage.priced} of {s.quoteCoverage.held} holdings. Top three are {pct(s.topThreeWeight, 0)} of value.
          {s.largestSector ? ` Largest sector: ${s.largestSector.sector} (${pct(s.largestSector.weight, 0)}).` : ''}
        </Muted>
      </Card>

      <ValueVsMoneyInCard />
      <MoneyWeightedReturnCard />

      <Collapsible title="Allocation" defaultOpen>
        {r.companyAllocation.map((a) => (
          <Bar key={a.ticker} label={a.ticker} value={pct(a.weight)} fraction={a.weight / maxAlloc} />
        ))}
        <Muted>How this is calculated: each company’s share of the market value of priced holdings (shares × last saved price).</Muted>
      </Collapsible>

      <Collapsible title="Sectors">
        {r.sectorAllocation.map((a) => (
          <Bar key={a.sector} label={a.sector} value={pct(a.weight)} fraction={a.weight / 100} />
        ))}
        <Muted>How this is calculated: the same priced holdings grouped by each company’s sector.</Muted>
      </Collapsible>

      {r.targetComparison.some((t) => t.target > 0) ? (
        <Collapsible title="Actual vs target">
          {r.targetComparison
            .filter((t) => t.target > 0)
            .map((t) => (
              <View key={t.ticker} style={styles.row} accessible accessibilityLabel={`${t.ticker}, actual ${pct(t.actual)} of the portfolio, target ${pct(t.target)}`}>
                <Text style={styles.text}>{t.ticker}</Text>
                <Text style={styles.number}>
                  {pct(t.actual)} / {pct(t.target)}
                </Text>
              </View>
            ))}
          <Muted>How this is calculated: today’s weight of priced holdings against the target you set in Plan.</Muted>
        </Collapsible>
      ) : null}

      <Collapsible title="Gain by company">
        {r.performance.map((a) => (
          <View key={a.ticker} style={styles.row} accessible accessibilityLabel={`${a.ticker}, ${signedAmountLabel(a.gain, money)}, ${signedPercentLabel(a.gainPercent)}`}>
            <Text style={styles.text}>{a.ticker}</Text>
            <Text style={[styles.number, { color: a.gain >= 0 ? colors.gain : colors.loss, flexShrink: 1 }]}>
              {signedMoney(a.gain, false)} ({signedPercent(a.gainPercent)})
            </Text>
          </View>
        ))}
        <Muted>How this is calculated: unrealised gain = market value − cost of current holdings (average cost, fees included).</Muted>
      </Collapsible>

      {lastMonths.length ? (
        <Collapsible title={`Bought, last ${lastMonths.length} months`}>
          {lastMonths.map((m) => (
            <Bar key={m.month} label={m.month} value={moneyShort(m.invested)} fraction={m.invested / maxMonth} />
          ))}
          <Muted>How this is calculated: buys plus fees in each calendar month.</Muted>
        </Collapsible>
      ) : null}

      <Collapsible title="Income and realised">
        <Muted>
          Realised gain {money(r.realized.totalRealizedGain)}. Dividends received (gross) {money(r.realized.totalDividendIncomeGross)}.
          {r.realized.totalCapitalGainsTax !== null ? ` Estimated capital gains tax ${money(r.realized.totalCapitalGainsTax)}.` : ''}
          {r.realized.taxProfileSet ? '' : ' Set your tax status in More for tax estimates.'}
        </Muted>
        <Muted>How this is calculated: realised gain is sales at average cost, after fees. Only dividends marked received count; expected ones do not.</Muted>
      </Collapsible>

      <BenchmarkCard />
    </>
  );
}
