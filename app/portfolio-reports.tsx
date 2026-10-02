'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Pie,
  PieChart,
  Rectangle,
  ReferenceLine,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { money, moneyShort, round, type Portfolio } from '@/lib/portfolio';
import { TickerLink } from './ticker-link';
import {
  portfolioReport,
  type DividendCompanyPoint,
  type InvestmentCompanyPoint,
  type PerformancePoint,
  type RealizedCompanyPoint,
  type SectorPoint,
} from '@/lib/portfolio-reports';

const companyConfig = {
  weight: { label: 'Portfolio weight', color: 'var(--primary)' },
} satisfies ChartConfig;

const activityConfig = {
  invested: { label: 'Cash invested', color: 'var(--primary)' },
} satisfies ChartConfig;

const cumulativeConfig = {
  cumulative: { label: 'Cumulative invested', color: 'var(--primary)' },
} satisfies ChartConfig;

const dividendActivityConfig = {
  net: { label: 'Net received', color: 'var(--primary)' },
  gross: { label: 'Gross declared', color: '#7f93b8' },
} satisfies ChartConfig;

const dividendCompanyConfig = {
  net: { label: 'Net received', color: 'var(--primary)' },
} satisfies ChartConfig;

const realizedActivityConfig = {
  net: { label: 'Net realised gain', color: 'var(--primary)' },
} satisfies ChartConfig;

const realizedCompanyConfig = {
  net: { label: 'Net realised gain', color: 'var(--primary)' },
} satisfies ChartConfig;

const performanceConfig = {
  gainPercent: { label: 'Gain / loss', color: 'var(--success)' },
} satisfies ChartConfig;

// Validated against this app's dark surface (#05070d) with
// scripts/validate_palette.js from the dataviz skill: fixed hue order,
// worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3.
const sectorColors = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
];
const OTHER_SECTOR_COLOR = '#5b6b85';

function foldSectors(sectors: SectorPoint[], cap = sectorColors.length) {
  if (sectors.length <= cap) return sectors;
  const rest = sectors.slice(cap);
  return [
    ...sectors.slice(0, cap),
    {
      sector: 'Other',
      value: round(rest.reduce((total, item) => total + item.value, 0)),
      weight: round(rest.reduce((total, item) => total + item.weight, 0)),
    },
  ];
}

function foldDividendCompanies(
  companies: DividendCompanyPoint[],
  cap = 7,
): DividendCompanyPoint[] {
  if (companies.length <= cap) return companies;
  const rest = companies.slice(cap);
  const restNet = rest.some((item) => item.net === null)
    ? null
    : round(rest.reduce((total, item) => total + (item.net ?? 0), 0));
  const restWeight = rest.some((item) => item.weight === null)
    ? null
    : round(rest.reduce((total, item) => total + (item.weight ?? 0), 0));
  return [
    ...companies.slice(0, cap),
    {
      ticker: 'Other',
      name: 'Other companies',
      gross: round(rest.reduce((total, item) => total + item.gross, 0)),
      net: restNet,
      weight: restWeight,
    },
  ];
}

function foldInvestmentCompanies(
  companies: InvestmentCompanyPoint[],
  cap = 7,
): InvestmentCompanyPoint[] {
  if (companies.length <= cap) return companies;
  const rest = companies.slice(cap);
  return [
    ...companies.slice(0, cap),
    {
      ticker: 'Other',
      name: 'Other companies',
      amount: round(rest.reduce((total, item) => total + item.amount, 0)),
      weight: round(rest.reduce((total, item) => total + item.weight, 0)),
    },
  ];
}

function performanceBarShape(props: BarShapeProps) {
  const { payload, ...rest } = props;
  const gain = (payload as PerformancePoint).gain;
  return (
    <Rectangle
      {...rest}
      radius={[3, 3, 3, 3]}
      fill={gain >= 0 ? 'var(--success)' : 'var(--danger)'}
    />
  );
}

function realizedCompanyBarShape(props: BarShapeProps) {
  const { payload, ...rest } = props;
  const point = payload as RealizedCompanyPoint;
  const amount = point.net ?? point.gain;
  return (
    <Rectangle
      {...rest}
      radius={4}
      fill={amount >= 0 ? 'var(--success)' : 'var(--danger)'}
    />
  );
}

function realizedMonthBarShape(props: BarShapeProps) {
  const { payload, ...rest } = props;
  const point = payload as { net: number | null; gain: number };
  const amount = point.net ?? point.gain;
  return (
    <Rectangle
      {...rest}
      radius={[3, 3, 3, 3]}
      fill={amount >= 0 ? 'var(--success)' : 'var(--danger)'}
    />
  );
}

const monthLabel = (month: string) => {
  const [year, value] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PK', {
    month: 'short',
    year: '2-digit',
  }).format(new Date(year, value - 1, 1));
};

export default function PortfolioReports({
  portfolio,
}: {
  portfolio: Portfolio;
}) {
  const [view, setView] = useState<
    'all' | 'allocation' | 'performance' | 'income' | 'activity'
  >(() =>
    // Phones start on Performance rather than rendering every chart at once.
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 760px)').matches
      ? 'performance'
      : 'all',
  );
  const report = portfolioReport(portfolio);
  const completeQuotes =
    report.summary.quoteCoverage.percentage === 100 &&
    report.summary.quoteCoverage.held > 0;
  const activity = report.monthlyActivity.map((item) => ({
    ...item,
    label: monthLabel(item.month),
  }));
  const sectors = foldSectors(report.sectorAllocation);
  const recentInvestment = foldInvestmentCompanies(
    report.recentInvestmentByCompany,
  );
  const recentInvestmentTotal = round(
    recentInvestment.reduce((total, item) => total + item.amount, 0),
  );
  const recentInvestmentTickers = new Set(
    recentInvestment.map((item) => item.ticker),
  );
  const recentInvestmentRows = report.recentInvestmentActivity.map(
    (point) => {
      const row: Record<string, number | string> = {
        month: point.month,
        label: monthLabel(point.month),
      };
      for (const item of recentInvestment) row[item.ticker] = 0;
      for (const company of point.byCompany) {
        const key = recentInvestmentTickers.has(company.ticker)
          ? company.ticker
          : 'Other';
        row[key] = (row[key] as number) + company.amount;
      }
      return row;
    },
  );
  const recentInvestmentConfig: ChartConfig = Object.fromEntries(
    recentInvestment.map((item) => [item.ticker, { label: item.name }]),
  );
  const dividendActivity = report.dividendActivity
    .slice(-12)
    .map((item) => ({
      ...item,
      label: monthLabel(item.month),
    }));
  const dividendCompanies = foldDividendCompanies(report.dividendByCompany);
  const realizedActivity = report.realizedActivity.map((item) => ({
    ...item,
    label: monthLabel(item.month),
  }));
  const realizedCompanies = report.realizedByCompany.slice(0, 8);
  const totalDividendNet =
    report.realized.totalDividendTax === null
      ? null
      : round(
          report.realized.totalDividendIncomeGross -
            report.realized.totalDividendTax,
        );
  const maxAbsGain = Math.max(
    1,
    ...report.performance.map((item) => Math.abs(item.gainPercent)),
  );
  const totalGain = report.summary.totalGain;
  const totalGainPercent = report.summary.totalGainPercent;
  const grandTotalReturn = report.summary.grandTotalReturn;
  const cumulativeTotal = activity.length
    ? activity[activity.length - 1].cumulative
    : 0;

  return (
    <div className="reports" data-view={view}>
      <div className="reports-intro">
        <div className="reports-intro-header">
          <p className="eyebrow">PORTFOLIO REPORTS</p>
          <p>
            See where your portfolio is concentrated. Allocation uses your latest saved PSX prices; purchase activity is based on recorded transactions.
          </p>
        </div>
        <div className="reports-hero-stats">
          <div className="reports-priced-value">
            <span>Priced market value</span>
            <strong>{moneyShort(report.summary.pricedValue)}</strong>
            <small>
              {report.summary.quoteCoverage.priced} of{' '}
              {report.summary.quoteCoverage.held} held companies priced
            </small>
          </div>
          <div
            className={`reports-priced-value ${totalGain === null ? '' : totalGain >= 0 ? 'pos' : 'neg'}`}
          >
            <span>Unrealised gain / loss</span>
            <strong>
              {totalGain === null
                ? '—'
                : `${totalGain >= 0 ? '+' : ''}${moneyShort(totalGain)}`}
            </strong>
            <small>
              {totalGainPercent === null
                ? 'Add purchase prices to calculate'
                : `${totalGainPercent >= 0 ? '+' : ''}${totalGainPercent.toFixed(1)}% vs cost basis`}
            </small>
          </div>
          <div className="reports-priced-value">
            <span>Dividend income received</span>
            <strong>
              {totalDividendNet === null
                ? moneyShort(report.realized.totalDividendIncomeGross)
                : moneyShort(totalDividendNet)}
            </strong>
            <small>
              {totalDividendNet === null
                ? 'Gross · set filer status in Settings for net'
                : 'Net of tax (estimated unless a deduction is recorded)'}
              {report.realized.expectedDividends.count > 0 &&
                ` · ${report.realized.expectedDividends.count} expected, ${money(report.realized.expectedDividends.grossAmount)} gross not yet confirmed`}
              {report.realized.receivedUnknownPaymentDate.count > 0 &&
                ` · ${report.realized.receivedUnknownPaymentDate.count} received on your confirmation with no payment date (${money(report.realized.receivedUnknownPaymentDate.grossAmount)} gross, calculated; shown by book closure and kept out of any tax year)`}
            </small>
          </div>
          <div
            className={`reports-priced-value ${grandTotalReturn === null ? '' : grandTotalReturn >= 0 ? 'pos' : 'neg'}`}
          >
            <span>Total return (after estimated tax)</span>
            <strong>
              {grandTotalReturn === null
                ? '—'
                : `${grandTotalReturn >= 0 ? '+' : ''}${moneyShort(grandTotalReturn)}`}
            </strong>
            <small>
              {grandTotalReturn !== null
                ? 'Unrealised + realised sales + received dividends, after estimated tax'
                : !portfolio.taxProfile
                  ? 'Set your filer status in Settings to include tax'
                  : 'Add missing purchase prices or cost basis to calculate'}
            </small>
          </div>
        </div>
      </div>

      {!completeQuotes && report.summary.quoteCoverage.held > 0 && (
        <output className="reports-note">
          Allocation charts cover the{' '}
          {report.summary.quoteCoverage.percentage.toFixed(0)}% of held
          companies with saved prices. Actual-versus-target weights stay hidden
          until every holding is priced.
        </output>
      )}

      <section className="reports-summary" aria-label="Concentration summary">
        <article>
          <span>Largest holding</span>
          <strong>
            {report.summary.largestHolding ? (
              <TickerLink ticker={report.summary.largestHolding.ticker} />
            ) : (
              '—'
            )}
          </strong>
          <small>
            {report.summary.largestHolding
              ? `${report.summary.largestHolding.weight.toFixed(1)}% of priced value`
              : 'Add prices to calculate'}
          </small>
        </article>
        <article>
          <span>Top three holdings</span>
          <strong>
            {report.summary.topThreeWeight === null
              ? '—'
              : `${report.summary.topThreeWeight.toFixed(1)}%`}
          </strong>
          <small>Combined share of priced value</small>
        </article>
        <article>
          <span>Largest sector</span>
          <strong>{report.summary.largestSector?.sector ?? '—'}</strong>
          <small>
            {report.summary.largestSector
              ? `${report.summary.largestSector.weight.toFixed(1)}% of priced value`
              : 'Assign sectors and add prices'}
          </small>
        </article>
        <article>
          <span>Quote coverage</span>
          <strong>{report.summary.quoteCoverage.percentage.toFixed(0)}%</strong>
          <small>Held companies with a saved price</small>
        </article>
      </section>

      <div className="reports-tabs seg" aria-label="Report section">
        {(
          [
            ['all', 'All'],
            ['allocation', 'Allocation'],
            ['performance', 'Performance'],
            ['income', 'Income'],
            ['activity', 'Investing'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            data-active={view === value || undefined}
            onClick={() => setView(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="reports-grid" style={{ marginBottom: 20 }}>
        <section className="panel report-panel" data-group="performance">
          <div className="report-heading">
            <div>
              <p className="eyebrow">REALISED P&amp;L &amp; TAX</p>
              <h3>Realised gains by month</h3>
            </div>
            <span>Estimated tax (15% filer / 30% non-filer), unless a deduction is recorded</span>
          </div>
          {realizedActivity.length ? (
            <ChartContainer
              config={realizedActivityConfig}
              className="report-chart report-chart--trend"
            >
              <BarChart
                accessibilityLayer
                data={realizedActivity}
                margin={{ top: 12, right: 10, bottom: 24, left: 16 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  label={{
                    value: 'Sale month',
                    position: 'insideBottom',
                    offset: -16,
                  }}
                />
                <YAxis
                  width={72}
                  tickFormatter={(value) =>
                    new Intl.NumberFormat('en-PK', {
                      notation: 'compact',
                    }).format(value)
                  }
                />
                <ReferenceLine y={0} stroke="var(--border)" />
                <ChartTooltip
                  cursor={{ fill: 'rgba(148,178,225,.12)' }}
                  content={
                    <ChartTooltipContent
                      formatter={(_value, _name, item) => {
                        const point = item.payload as (typeof realizedActivity)[number];
                        const amount = point.net ?? point.gain;
                        return (
                          <div className="report-tooltip-row">
                            <span>
                              {point.net === null ? 'Gross gain' : 'Net gain'}
                            </span>
                            <b>{money(amount)}</b>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar
                  dataKey={(item: (typeof realizedActivity)[number]) =>
                    item.net ?? item.gain
                  }
                  shape={realizedMonthBarShape}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>Record a sale to see realised gains here.</ReportEmpty>
          )}
          <p className="report-source">
            Source: recorded sales · realised gains only
          </p>
        </section>

        <section className="panel report-panel" data-group="performance">
          <div className="report-heading">
            <div>
              <p className="eyebrow">REALISED P&amp;L &amp; TAX</p>
              <h3>Realised gain / loss by company</h3>
            </div>
            <span>Net of estimated capital gains tax</span>
          </div>
          {realizedCompanies.length ? (
            <ChartContainer
              config={realizedCompanyConfig}
              className="report-chart"
              style={{
                height: Math.max(220, realizedCompanies.length * 34 + 70),
              }}
            >
              <BarChart
                accessibilityLayer
                data={realizedCompanies}
                layout="vertical"
                margin={{ top: 8, right: 44, bottom: 20, left: 4 }}
              >
                <CartesianGrid horizontal={false} />
                <XAxis
                  type="number"
                  tickFormatter={(value) =>
                    new Intl.NumberFormat('en-PK', {
                      notation: 'compact',
                    }).format(value)
                  }
                  label={{
                    value: 'Realised gain / loss (PKR)',
                    position: 'insideBottom',
                    offset: -12,
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="ticker"
                  width={58}
                  tickLine={false}
                  axisLine={false}
                />
                <ReferenceLine x={0} stroke="var(--border)" />
                <ChartTooltip
                  cursor={{ fill: 'rgba(148,178,225,.12)' }}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(_value, _name, item) => {
                        const point = item.payload as RealizedCompanyPoint;
                        return (
                          <div className="report-tooltip-row">
                            <span>{point.name}</span>
                            <b>
                              {point.net === null
                                ? `${money(point.gain)} gross`
                                : `${money(point.net)} net`}
                              {point.weight === null
                                ? ''
                                : ` · ${point.weight.toFixed(1)}%`}
                            </b>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar
                  dataKey={(item: RealizedCompanyPoint) =>
                    item.net ?? item.gain
                  }
                  shape={realizedCompanyBarShape}
                >
                  <LabelList
                    dataKey={(item: RealizedCompanyPoint) =>
                      item.net ?? item.gain
                    }
                    position="right"
                    formatter={(value) =>
                      new Intl.NumberFormat('en-PK', {
                        notation: 'compact',
                      }).format(Number(value))
                    }
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>Record a sale to see realised gains here.</ReportEmpty>
          )}
          <p className="report-source">
            Source: recorded sales, ranked by absolute gain / loss
          </p>
        </section>
      </div>

      <div className="reports-grid">
        <section className="panel report-panel" data-group="income">
          <div className="report-heading">
            <div>
              <p className="eyebrow">DIVIDEND TRAJECTORY</p>
              <h3>Net received, last 12 months</h3>
            </div>
            <span>
              {dividendActivity.length
                ? money(
                    round(
                      dividendActivity.reduce(
                        (sum, item) => sum + (item.net ?? 0),
                        0,
                      ),
                    ),
                  )
                : '—'}{' '}
              total
            </span>
          </div>
          {dividendActivity.length ? (
            <ChartContainer
              config={dividendActivityConfig}
              className="report-chart report-chart--trend"
            >
              <BarChart
                accessibilityLayer
                data={dividendActivity}
                margin={{ top: 12, right: 10, bottom: 24, left: 16 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  label={{
                    value: 'Dividend month',
                    position: 'insideBottom',
                    offset: -16,
                  }}
                />
                <YAxis
                  width={72}
                  tickFormatter={(value) =>
                    new Intl.NumberFormat('en-PK', {
                      notation: 'compact',
                    }).format(value)
                  }
                />
                <ChartTooltip
                  cursor={{ fill: 'rgba(148,178,225,.12)' }}
                  content={
                    <ChartTooltipContent
                      formatter={(_value, _name, item) => {
                        const point = item.payload as (typeof dividendActivity)[number];
                        const amount = point.net ?? point.gross;
                        return (
                          <div className="report-tooltip-row">
                            <span>
                              {point.net === null ? 'Gross declared' : 'Net received'}
                            </span>
                            <b>{money(amount)}</b>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar
                  dataKey={(item: (typeof dividendActivity)[number]) =>
                    item.net ?? item.gross
                  }
                  fill="var(--color-net)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>
              Record dividends to see your income trajectory.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: net dividend income by month · post-withholding
          </p>
        </section>

        <section className="panel report-panel" data-group="income">
          <div className="report-heading">
            <div>
              <p className="eyebrow">TOP PAYERS</p>
              <h3>Dividend income by company</h3>
            </div>
            <span>Net received, ranked</span>
          </div>
          {dividendCompanies.length ? (
            <ChartContainer
              config={dividendCompanyConfig}
              className="report-chart"
              style={{
                height: Math.max(220, dividendCompanies.length * 34 + 70),
              }}
            >
              <BarChart
                accessibilityLayer
                data={dividendCompanies}
                layout="vertical"
                margin={{ top: 8, right: 44, bottom: 20, left: 4 }}
              >
                <defs>
                  <linearGradient
                    id="dividendCompanyFill"
                    x1="0"
                    y1="0"
                    x2="1"
                    y2="0"
                  >
                    <stop offset="0%" stopColor="var(--primary)" />
                    <stop offset="100%" stopColor="#7dd3fc" />
                  </linearGradient>
                </defs>
                <CartesianGrid horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 'dataMax']}
                  tickFormatter={(value) =>
                    new Intl.NumberFormat('en-PK', {
                      notation: 'compact',
                    }).format(value)
                  }
                  label={{
                    value: 'Net dividend income (PKR)',
                    position: 'insideBottom',
                    offset: -12,
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="ticker"
                  width={58}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip
                  cursor={{ fill: 'rgba(148,178,225,.12)' }}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(_value, _name, item) => {
                        const point = item.payload as DividendCompanyPoint;
                        return (
                          <div className="report-tooltip-row">
                            <span>{point.name}</span>
                            <b>
                              {point.net === null
                                ? `${money(point.gross)} gross`
                                : `${money(point.net)} net`}
                              {point.weight === null
                                ? ''
                                : ` · ${point.weight.toFixed(1)}%`}
                            </b>
                          </div>
                        );
                      }}
                    />
                  }
                />
                <Bar
                  dataKey={(item: DividendCompanyPoint) =>
                    item.net ?? item.gross
                  }
                  fill="url(#dividendCompanyFill)"
                  radius={[0, 5, 5, 0]}
                >
                  <LabelList
                    dataKey={(item: DividendCompanyPoint) =>
                      item.net ?? item.gross
                    }
                    position="right"
                    formatter={(value) =>
                      new Intl.NumberFormat('en-PK', {
                        notation: 'compact',
                      }).format(Number(value))
                    }
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>
              Record dividends to see which companies pay the most.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: recorded dividends, net where filer status is set ·
            grouped by company
          </p>
        </section>

        <section className="panel report-panel" data-group="allocation">
          <div className="report-heading">
            <div>
              <p className="eyebrow">ALLOCATION LADDER</p>
              <h3>Company weight</h3>
            </div>
            <span>Percent of priced market value</span>
          </div>
          {report.companyAllocation.length ? (
            <ChartContainer
              config={companyConfig}
              className="report-chart"
              style={{
                height: Math.max(
                  310,
                  report.companyAllocation.length * 34 + 70,
                ),
              }}
            >
              <BarChart
                accessibilityLayer
                data={report.companyAllocation}
                layout="vertical"
                margin={{ top: 8, right: 44, bottom: 20, left: 4 }}
              >
                <defs>
                  <linearGradient id="allocationFill" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--primary)" />
                    <stop offset="100%" stopColor="#7dd3fc" />
                  </linearGradient>
                </defs>
                <CartesianGrid horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 'dataMax']}
                  tickFormatter={(value) => `${value}%`}
                  label={{
                    value: 'Portfolio weight (%)',
                    position: 'insideBottom',
                    offset: -12,
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="ticker"
                  width={58}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip
                  cursor={{ fill: 'rgba(148,178,225,.12)' }}
                  content={
                    <ChartTooltipContent
                      hideLabel
                      formatter={(value, _name, item) => (
                        <div className="report-tooltip-row">
                          <span>{item.payload.name}</span>
                          <b>
                            {Number(value).toFixed(1)}% ·{' '}
                            {money(item.payload.value)}
                          </b>
                        </div>
                      )}
                    />
                  }
                />
                <Bar dataKey="weight" fill="url(#allocationFill)" radius={[0, 5, 5, 0]}>
                  <LabelList
                    dataKey="weight"
                    position="right"
                    formatter={(value) => `${Number(value).toFixed(1)}%`}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>
              Add current prices to see company allocation.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: saved holdings and latest portfolio quotes · current
            snapshot
          </p>
        </section>

        <section className="panel report-panel" data-group="performance">
          <div className="report-heading">
            <div>
              <p className="eyebrow">PERFORMANCE</p>
              <h3>Gain / loss vs cost</h3>
            </div>
            <span>Unrealised, by company</span>
          </div>
          {report.performance.length ? (
            <>
              <ChartContainer
                config={performanceConfig}
                className="report-chart"
                style={{
                  height: Math.max(220, report.performance.length * 32 + 60),
                }}
              >
                <BarChart
                  accessibilityLayer
                  data={report.performance}
                  layout="vertical"
                  margin={{ top: 8, right: 20, bottom: 20, left: 4 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[-maxAbsGain, maxAbsGain]}
                    tickFormatter={(value) =>
                      `${Number(value) >= 0 ? '+' : ''}${value}%`
                    }
                    label={{
                      value: 'Gain / loss (%)',
                      position: 'insideBottom',
                      offset: -12,
                    }}
                  />
                  <YAxis
                    type="category"
                    dataKey="ticker"
                    width={58}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ReferenceLine x={0} stroke="var(--border)" />
                  <ChartTooltip
                    cursor={{ fill: 'rgba(148,178,225,.12)' }}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        formatter={(value, _name, item) => (
                          <div className="report-tooltip-row">
                            <span>{item.payload.name}</span>
                            <b
                              className={
                                item.payload.gain >= 0 ? 'pos-text' : 'neg-text'
                              }
                            >
                              {item.payload.gain >= 0 ? '+' : ''}
                              {money(item.payload.gain)} (
                              {Number(value) >= 0 ? '+' : ''}
                              {Number(value).toFixed(1)}%)
                            </b>
                          </div>
                        )}
                      />
                    }
                  />
                  <Bar dataKey="gainPercent" shape={performanceBarShape} />
                </BarChart>
              </ChartContainer>
              <div className="perf-key" aria-label="Gain and loss by company">
                {report.performance.map((item) => (
                  <div key={item.ticker}>
                    <TickerLink ticker={item.ticker} />
                    <b className={item.gain >= 0 ? 'pos-text' : 'neg-text'}>
                      {item.gain >= 0 ? '+' : ''}
                      {item.gainPercent.toFixed(1)}%
                    </b>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ReportEmpty>
              Add purchase prices to every holding to see gain and loss.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: recorded cost basis vs latest portfolio quotes · unrealised
          </p>
        </section>

        <section className="panel report-panel" data-group="allocation">
          <div className="report-heading">
            <div>
              <p className="eyebrow">DIVERSIFICATION</p>
              <h3>Sector allocation</h3>
            </div>
            <span>Current snapshot</span>
          </div>
          {sectors.length ? (
            <ChartContainer
              config={{ value: { label: 'Market value' } }}
              className="report-chart report-chart--square"
            >
              <PieChart accessibilityLayer>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      nameKey="sector"
                      formatter={(value, _name, item) => (
                        <div className="report-tooltip-row">
                          <span>{item.payload.sector}</span>
                          <b>
                            {item.payload.weight.toFixed(1)}% ·{' '}
                            {money(Number(value))}
                          </b>
                        </div>
                      )}
                    />
                  }
                />
                <Pie
                  data={sectors.map((item, index) => ({
                    ...item,
                    fill:
                      item.sector === 'Other'
                        ? OTHER_SECTOR_COLOR
                        : sectorColors[index % sectorColors.length],
                  }))}
                  dataKey="value"
                  nameKey="sector"
                  innerRadius="55%"
                  outerRadius="78%"
                  paddingAngle={2}
                />
              </PieChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>
              Assign company sectors and add prices to see diversification.
            </ReportEmpty>
          )}
          <div className="sector-key" aria-label="Sector allocation legend">
            {sectors.map((item, index) => (
              <div key={item.sector}>
                <i
                  aria-hidden="true"
                  style={{
                    background:
                      item.sector === 'Other'
                        ? OTHER_SECTOR_COLOR
                        : sectorColors[index % sectorColors.length],
                  }}
                />
                <span>{item.sector}</span>
                <b>{item.weight.toFixed(1)}%</b>
              </div>
            ))}
          </div>
          <p className="report-source">
            Source: company sectors and priced market values · PKR
          </p>
        </section>

        <section className="panel report-panel" data-group="activity">
          <div className="report-heading">
            <div>
              <p className="eyebrow">SIP ACTIVITY</p>
              <h3>Monthly investment by company</h3>
            </div>
            <span>
              {recentInvestment.length ? money(recentInvestmentTotal) : '—'}{' '}
              invested
            </span>
          </div>
          {recentInvestment.length ? (
            <>
              <ChartContainer
                config={recentInvestmentConfig}
                className="report-chart report-chart--medium"
              >
                <BarChart
                  accessibilityLayer
                  data={recentInvestmentRows}
                  margin={{ top: 12, right: 16, bottom: 24, left: 16 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    label={{
                      value: 'Month',
                      position: 'insideBottom',
                      offset: -16,
                    }}
                  />
                  <YAxis
                    width={72}
                    tickFormatter={(value) =>
                      new Intl.NumberFormat('en-PK', {
                        notation: 'compact',
                      }).format(value)
                    }
                    label={{
                      value: 'Invested (PKR)',
                      angle: -90,
                      position: 'insideLeft',
                    }}
                  />
                  <ChartTooltip
                    cursor={{ fill: 'rgba(148,178,225,.12)' }}
                    content={
                      <ChartTooltipContent
                        formatter={(value, name, item) => {
                          if (!Number(value)) return null;
                          const company = recentInvestment.find(
                            (entry) => entry.ticker === name,
                          );
                          const monthPoint =
                            report.recentInvestmentActivity.find(
                              (entry) => entry.month === item.payload.month,
                            );
                          const monthPct =
                            monthPoint && monthPoint.total > 0
                              ? ((Number(value) / monthPoint.total) * 100).toFixed(1)
                              : '0.0';
                          return (
                            <div className="report-tooltip-row">
                              <span>{company?.name ?? name}</span>
                              <b>
                                {money(Number(value))} · {monthPct}%
                              </b>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  {recentInvestment.map((item, index) => (
                    <Bar
                      key={item.ticker}
                      dataKey={item.ticker}
                      stackId="invested"
                      fill={
                        item.ticker === 'Other'
                          ? OTHER_SECTOR_COLOR
                          : sectorColors[index % sectorColors.length]
                      }
                      radius={
                        index === recentInvestment.length - 1
                          ? [4, 4, 0, 0]
                          : 0
                      }
                    />
                  ))}
                </BarChart>
              </ChartContainer>
              <div
                className="sector-key"
                aria-label="Recent investment legend"
              >
                {recentInvestment.map((item, index) => (
                  <div key={item.ticker}>
                    <i
                      aria-hidden="true"
                      style={{
                        background:
                          item.ticker === 'Other'
                            ? OTHER_SECTOR_COLOR
                            : sectorColors[index % sectorColors.length],
                      }}
                    />
                    <span>{item.name}</span>
                    <b>{item.weight.toFixed(1)}%</b>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <ReportEmpty>
              Record a purchase in the last 12 months to see this breakdown.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: recorded buy trades, last 12 months · cost basis (shares ×
            price + fees)
          </p>
        </section>

        <section className="panel report-panel" data-group="activity">
          <div className="report-heading">
            <div>
              <p className="eyebrow">CONTRIBUTION RHYTHM</p>
              <h3>Monthly purchase activity</h3>
            </div>
            <span>PKR invested, including fees</span>
          </div>
          {activity.length ? (
            <ChartContainer
              config={activityConfig}
              className="report-chart report-chart--activity"
            >
              <BarChart
                accessibilityLayer
                data={activity}
                margin={{ top: 12, right: 10, bottom: 24, left: 16 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  label={{
                    value: 'Purchase month',
                    position: 'insideBottom',
                    offset: -16,
                  }}
                />
                <YAxis
                  width={72}
                  tickFormatter={(value) =>
                    new Intl.NumberFormat('en-PK', {
                      notation: 'compact',
                    }).format(value)
                  }
                  label={{
                    value: 'Invested (PKR)',
                    angle: -90,
                    position: 'insideLeft',
                  }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <div className="report-tooltip-row">
                          <span>Cash invested</span>
                          <b>{money(Number(value))}</b>
                        </div>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="invested"
                  fill="var(--color-invested)"
                  radius={[5, 5, 0, 0]}
                  maxBarSize={56}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>
              Record purchases to see monthly investment activity.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: non-voided purchase transactions · opening balances and
            sales excluded
          </p>
        </section>

        <section className="panel report-panel" data-group="activity">
          <div className="report-heading">
            <div>
              <p className="eyebrow">SIP TRAJECTORY</p>
              <h3>Cumulative invested</h3>
            </div>
            <span>{activity.length ? money(cumulativeTotal) : '—'} to date</span>
          </div>
          {activity.length ? (
            <ChartContainer
              config={cumulativeConfig}
              className="report-chart report-chart--trend"
            >
              <AreaChart
                accessibilityLayer
                data={activity}
                margin={{ top: 12, right: 10, bottom: 24, left: 16 }}
              >
                <defs>
                  <linearGradient id="cumulativeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  label={{
                    value: 'Purchase month',
                    position: 'insideBottom',
                    offset: -16,
                  }}
                />
                <YAxis
                  width={72}
                  tickFormatter={(value) =>
                    new Intl.NumberFormat('en-PK', {
                      notation: 'compact',
                    }).format(value)
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => (
                        <div className="report-tooltip-row">
                          <span>Cumulative invested</span>
                          <b>{money(Number(value))}</b>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  fill="url(#cumulativeFill)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>
              Record purchases to see your contribution trajectory.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: running total of non-voided purchases · opening balances
            and sales excluded
          </p>
        </section>
      </div>
    </div>
  );
}

function ReportEmpty({ children }: { children: React.ReactNode }) {
  return <div className="report-empty">{children}</div>;
}
