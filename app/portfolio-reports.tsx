'use client';

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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { money, round, type Portfolio } from '@/lib/portfolio';
import {
  portfolioReport,
  type PerformancePoint,
  type SectorPoint,
} from '@/lib/portfolio-reports';

const companyConfig = {
  weight: { label: 'Portfolio weight', color: 'var(--primary)' },
} satisfies ChartConfig;

const targetConfig = {
  actual: { label: 'Actual weight', color: 'var(--primary)' },
  target: { label: 'SIP target', color: '#7f93b8' },
} satisfies ChartConfig;

const activityConfig = {
  invested: { label: 'Cash invested', color: 'var(--primary)' },
} satisfies ChartConfig;

const cumulativeConfig = {
  cumulative: { label: 'Cumulative invested', color: 'var(--primary)' },
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
  const report = portfolioReport(portfolio);
  const completeQuotes =
    report.summary.quoteCoverage.percentage === 100 &&
    report.summary.quoteCoverage.held > 0;
  const activity = report.monthlyActivity.map((item) => ({
    ...item,
    label: monthLabel(item.month),
  }));
  const sectors = foldSectors(report.sectorAllocation);
  const maxAbsGain = Math.max(
    1,
    ...report.performance.map((item) => Math.abs(item.gainPercent)),
  );
  const totalGain = report.summary.totalGain;
  const totalGainPercent = report.summary.totalGainPercent;
  const cumulativeTotal = activity.length
    ? activity[activity.length - 1].cumulative
    : 0;

  return (
    <div className="reports">
      <div className="reports-intro">
        <div>
          <p className="eyebrow">PORTFOLIO REPORTS</p>
          <h2>See where your portfolio is concentrated.</h2>
          <p>
            Current allocation uses your latest saved PSX prices. Purchase
            activity uses recorded transactions, not estimated market history.
          </p>
        </div>
        <div className="reports-hero-stats">
          <div className="reports-priced-value">
            <span>Priced market value</span>
            <strong>{money(report.summary.pricedValue)}</strong>
            <small>
              {report.summary.quoteCoverage.priced} of{' '}
              {report.summary.quoteCoverage.held} held companies priced
            </small>
          </div>
          <div
            className={`reports-priced-value ${totalGain === null ? '' : totalGain >= 0 ? 'pos' : 'neg'}`}
          >
            <span>Unrealized gain / loss</span>
            <strong>
              {totalGain === null
                ? '—'
                : `${totalGain >= 0 ? '+' : ''}${money(totalGain)}`}
            </strong>
            <small>
              {totalGainPercent === null
                ? 'Add purchase prices to calculate'
                : `${totalGainPercent >= 0 ? '+' : ''}${totalGainPercent.toFixed(1)}% vs cost basis`}
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
          <strong>{report.summary.largestHolding?.ticker ?? '—'}</strong>
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

      <div className="reports-grid">
        <section className="panel report-panel">
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

        <section className="panel report-panel">
          <div className="report-heading">
            <div>
              <p className="eyebrow">PERFORMANCE</p>
              <h3>Gain / loss vs cost</h3>
            </div>
            <span>Unrealized, by company</span>
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
                    <span>{item.ticker}</span>
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
            Source: recorded cost basis vs latest portfolio quotes · unrealized
          </p>
        </section>

        <section className="panel report-panel">
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

        <section className="panel report-panel">
          <div className="report-heading">
            <div>
              <p className="eyebrow">SIP ALIGNMENT</p>
              <h3>Actual vs target</h3>
            </div>
            <span>Weight (%)</span>
          </div>
          {report.targetComparison.length ? (
            <ChartContainer
              config={targetConfig}
              className="report-chart report-chart--medium"
            >
              <BarChart
                accessibilityLayer
                data={report.targetComparison}
                margin={{ top: 12, right: 8, bottom: 24, left: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="ticker"
                  tickLine={false}
                  axisLine={false}
                  label={{
                    value: 'SIP company',
                    position: 'insideBottom',
                    offset: -16,
                  }}
                />
                <YAxis
                  tickFormatter={(value) => `${value}%`}
                  label={{
                    value: 'Weight (%)',
                    angle: -90,
                    position: 'insideLeft',
                  }}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="report-tooltip-row">
                          <span>
                            {targetConfig[name as keyof typeof targetConfig]
                              ?.label ?? name}
                          </span>
                          <b>{Number(value).toFixed(1)}%</b>
                        </div>
                      )}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="actual"
                  fill="var(--color-actual)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="target"
                  fill="var(--color-target)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <ReportEmpty>
              Set SIP targets to compare your current allocation.
            </ReportEmpty>
          )}
          {!completeQuotes && report.targetComparison.length > 0 && (
            <p className="report-inline-note">
              Actual weights require a saved price for every held company.
              Targets remain visible for reference.
            </p>
          )}
          <p className="report-source">
            Source: current priced holdings and saved SIP targets
          </p>
        </section>

        <section className="panel report-panel">
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

        <section className="panel report-panel">
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
