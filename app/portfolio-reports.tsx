'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { money, type Portfolio } from '@/lib/portfolio';
import { portfolioReport } from '@/lib/portfolio-reports';

const companyConfig = {
  weight: { label: 'Portfolio weight', color: '#125aeb' },
} satisfies ChartConfig;

const targetConfig = {
  actual: { label: 'Actual weight', color: '#125aeb' },
  target: { label: 'SIP target', color: '#92a4b9' },
} satisfies ChartConfig;

const activityConfig = {
  invested: { label: 'Cash invested', color: '#17744c' },
} satisfies ChartConfig;

const sectorColors = [
  '#125aeb',
  '#173f6b',
  '#3f78b5',
  '#17744c',
  '#5d7792',
  '#75629a',
  '#4b8b8b',
  '#8b6d4b',
  '#8a5264',
  '#9aa9ba',
];

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
        <div className="reports-priced-value">
          <span>Priced market value</span>
          <strong>{money(report.summary.pricedValue)}</strong>
          <small>
            {report.summary.quoteCoverage.priced} of{' '}
            {report.summary.quoteCoverage.held} held companies priced
          </small>
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
        <section className="panel report-panel report-panel--wide">
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
                  cursor={{ fill: '#edf3fa' }}
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
                <Bar
                  dataKey="weight"
                  fill="var(--color-weight)"
                  radius={[0, 5, 5, 0]}
                >
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
              <p className="eyebrow">DIVERSIFICATION</p>
              <h3>Sector allocation</h3>
            </div>
            <span>Current snapshot</span>
          </div>
          {report.sectorAllocation.length ? (
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
                  data={report.sectorAllocation.map((item, index) => ({
                    ...item,
                    fill: sectorColors[index % sectorColors.length],
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
            {report.sectorAllocation.map((item, index) => (
              <div key={item.sector}>
                <i
                  aria-hidden="true"
                  style={{
                    background: sectorColors[index % sectorColors.length],
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

        <section className="panel report-panel report-panel--wide">
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
                  maxBarSize={72}
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
      </div>
    </div>
  );
}

function ReportEmpty({ children }: { children: React.ReactNode }) {
  return <div className="report-empty">{children}</div>;
}
