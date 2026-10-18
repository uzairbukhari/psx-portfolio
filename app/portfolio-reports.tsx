'use client';

import { useState } from 'react';
import { EChart } from './charts/echart';
import {
  barOption,
  compact,
  donutOption,
  hBarOption,
  timeSeriesOption,
} from '@/lib/chart-kit';
import { money, moneyShort, round, type Portfolio } from '@/lib/portfolio';
import { ChartInfo } from './chart-info';
import { TickerLink, useOpenCompany } from './ticker-link';
import {
  portfolioReport,
  type DividendCompanyPoint,
  type InvestmentCompanyPoint,
  type SectorPoint,
} from '@/lib/portfolio-reports';

// Per-theme values live in globals.css (--cat-1..7). The dark values were validated against #05070d with
// scripts/validate_palette.js from the dataviz skill: fixed hue order,
// worst adjacent CVD ΔE 8.4, worst adjacent normal-vision ΔE 19.3.
const sectorColors = [
  'var(--cat-1)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-4)',
  'var(--cat-5)',
  'var(--cat-6)',
  'var(--cat-7)',
];
const OTHER_SECTOR_COLOR = 'var(--chart-other)';
/** The same palette as resolved colours for the canvas (the legends above still use the CSS variables). */
const catColor = (
  t: { cat: string[]; other: string },
  key: string,
  index: number,
) => (key === 'Other' ? t.other : t.cat[index % t.cat.length]);
const pct1 = (n: number) => `${n.toFixed(1)}%`;
const signedPct = (n: number) =>
  `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
const signedMoney = (n: number) => `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`;

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
  const openCompany = useOpenCompany();
  const openTicker = (name: string) => {
    if (name && name !== 'Other') openCompany(name);
  };
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
  const recentInvestmentRows = report.recentInvestmentActivity.map((point) => {
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
  });
  // Always the last 12 calendar months, including the ones with no dividend.
  const dividendActivity = (() => {
    const byMonth = new Map(
      report.dividendActivity.map((item) => [item.month, item]),
    );
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const item = byMonth.get(month);
      return {
        month,
        label: monthLabel(month),
        net: item?.net ?? (item ? null : 0),
        gross: item?.gross ?? 0,
      };
    });
  })();
  const dividendActivityHasData = report.dividendActivity.length > 0;
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
            See where your portfolio is concentrated. Allocation uses your
            latest saved PSX prices; purchase activity is based on recorded
            transactions.
          </p>
        </div>
        <div className="reports-hero-stats slab">
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

      <div className="reports-grid">
        <section className="panel report-panel" data-group="activity">
          <div className="report-heading">
            <div>
              <p className="eyebrow">SIP TRAJECTORY</p>
              <h3>
                Cumulative invested
                <ChartInfo text="Running total of everything you have put into purchases, month by month, including fees. Opening balances and sales are left out." />
              </h3>
            </div>
            <span>
              {activity.length ? money(cumulativeTotal) : '—'} to date
            </span>
          </div>
          {activity.length ? (
            <EChart
              className="report-chart report-chart--trend"
              label={`Cumulative invested by month, ${activity.length} months, ${money(cumulativeTotal)} to date.`}
              build={(t) =>
                timeSeriesOption(t, {
                  name: 'Cumulative invested',
                  data: activity.map((a) => ({ x: a.label, y: a.cumulative })),
                  categorical: true,
                  area: true,
                  includeZero: true,
                  zoom: false,
                  valueFormat: money,
                  dateLabel: (x) => String(x),
                })
              }
            />
          ) : (
            <ReportEmpty>
              Record purchases to see your contribution trajectory.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: running total of non-voided purchases · opening balances and
            sales excluded
          </p>
        </section>

        <section className="panel report-panel" data-group="activity">
          <div className="report-heading">
            <div>
              <p className="eyebrow">CONTRIBUTION RHYTHM</p>
              <h3>
                Monthly purchase activity
                <ChartInfo text="How much you invested in each calendar month, including fees. Months with no purchases show as zero so gaps in your habit are visible." />
              </h3>
            </div>
            <span>PKR invested, including fees</span>
          </div>
          {activity.length ? (
            <EChart
              className="report-chart report-chart--activity"
              label={`Monthly purchase activity, ${activity.length} months.`}
              build={(t) =>
                barOption(t, {
                  cats: activity.map((a) => a.label),
                  series: [
                    {
                      name: 'Cash invested',
                      data: activity.map((a) => a.invested),
                      color: t.primary,
                    },
                  ],
                  valueFormat: money,
                })
              }
            />
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
              <p className="eyebrow">SIP ACTIVITY</p>
              <h3>
                Monthly investment by company
                <ChartInfo text="Your recent monthly purchases split by company, so you can see which stocks your SIP money has gone to." />
              </h3>
            </div>
            <span>
              {recentInvestment.length ? money(recentInvestmentTotal) : '—'}{' '}
              invested
            </span>
          </div>
          {recentInvestment.length ? (
            <>
              <EChart
                className="report-chart report-chart--medium"
                label={`Monthly investment by company, last 12 months, ${money(recentInvestmentTotal)} in total.`}
                onPick={({ seriesName }) => openTicker(seriesName ?? '')}
                build={(t) =>
                  barOption(t, {
                    cats: recentInvestmentRows.map((r) => String(r.label)),
                    stack: true,
                    legend: true,
                    selectable: true,
                    legendSuffix: Object.fromEntries(
                      recentInvestment.map((item) => [
                        item.ticker,
                        pct1(item.weight),
                      ]),
                    ),
                    labels: Object.fromEntries(
                      recentInvestment.map((item) => [item.ticker, item.name]),
                    ),
                    series: recentInvestment.map((item, index) => ({
                      name: item.ticker,
                      data: recentInvestmentRows.map(
                        (r) => Number(r[item.ticker]) || 0,
                      ),
                      color: catColor(t, item.ticker, index),
                    })),
                    valueFormat: money,
                  })
                }
              />
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

        <section className="panel report-panel" data-group="allocation">
          <div className="report-heading">
            <div>
              <p className="eyebrow">DIVERSIFICATION</p>
              <h3>
                Sector allocation
                <ChartInfo text="Share of your priced portfolio value in each sector. The five largest sectors are shown; the rest are grouped as Other. Only held companies with a saved price and a sector are counted." />
              </h3>
            </div>
            <span>Current snapshot</span>
          </div>
          {sectors.length ? (
            <EChart
              className="report-chart report-chart--square"
              label={`Sector allocation: ${sectors.map((x) => `${x.sector} ${x.weight.toFixed(1)}%`).join(', ')}.`}
              build={(t) =>
                donutOption(t, {
                  centerTitle: 'Priced value',
                  slices: sectors.map((item, index) => ({
                    name: item.sector,
                    value: item.value,
                    color: catColor(t, item.sector, index),
                  })),
                  valueFormat: money,
                })
              }
            />
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

        <section className="panel report-panel" data-group="income">
          <div className="report-heading">
            <div>
              <p className="eyebrow">DIVIDEND TRAJECTORY</p>
              <h3>
                Net received, last 12 months
                <ChartInfo text="Cash dividends received each month over the last 12 months, after withholding tax." />
              </h3>
            </div>
            <span>
              {dividendActivityHasData
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
          {dividendActivityHasData ? (
            <EChart
              className="report-chart report-chart--trend"
              label={`Net dividends received per month, last 12 months.`}
              build={(t) =>
                barOption(t, {
                  cats: dividendActivity.map((d) => d.label),
                  series: [
                    {
                      name: 'Dividends',
                      data: dividendActivity.map((d) => d.net ?? d.gross),
                      color: t.primary,
                    },
                  ],
                  valueFormat: money,
                })
              }
            />
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
              <h3>
                Dividend income by company
                <ChartInfo text="Which companies paid you the most dividend income, ranked by net amount received." />
              </h3>
            </div>
            <span>Net received, ranked</span>
          </div>
          {dividendCompanies.length ? (
            <EChart
              className="report-chart"
              height={Math.max(220, dividendCompanies.length * 34 + 40)}
              label={`Dividend income by company: ${dividendCompanies
                .slice(0, 5)
                .map((d) => `${d.ticker} ${money(d.net ?? d.gross)}`)
                .join(', ')}.`}
              onPick={({ name }) => openTicker(name)}
              build={(t) =>
                hBarOption(t, {
                  name: 'Dividends',
                  cats: dividendCompanies.map((d) => d.ticker),
                  values: dividendCompanies.map((d) => d.net ?? d.gross),
                  selectable: true,
                  valueFormat: money,
                  labelFormat: (n) => compact(n),
                  axisFormat: (n) => compact(n),
                  catTitle: (_c, i) => dividendCompanies[i].name,
                  rows: (i) => {
                    const d = dividendCompanies[i];
                    return [
                      {
                        label: d.net === null ? 'Gross' : 'Net',
                        value: money(d.net ?? d.gross),
                      },
                      ...(d.weight === null
                        ? []
                        : [{ label: 'Share', value: pct1(d.weight) }]),
                    ];
                  },
                })
              }
            />
          ) : (
            <ReportEmpty>
              Record dividends to see which companies pay the most.
            </ReportEmpty>
          )}
          <p className="report-source">
            Source: recorded dividends, net where filer status is set · grouped
            by company
          </p>
        </section>

        <section className="panel report-panel" data-group="allocation">
          <div className="report-heading">
            <div>
              <p className="eyebrow">ALLOCATION LADDER</p>
              <h3>
                Company weight
                <ChartInfo text="Each holding as a share of your priced portfolio value, compared with its target weight once every holding has a price." />
              </h3>
            </div>
            <span>Percent of priced market value</span>
          </div>
          {report.companyAllocation.length ? (
            <EChart
              className="report-chart"
              height={Math.max(310, report.companyAllocation.length * 28 + 40)}
              label={`Company weights: ${report.companyAllocation
                .slice(0, 5)
                .map((c) => `${c.ticker} ${c.weight.toFixed(1)}%`)
                .join(', ')}.`}
              onPick={({ name }) => openTicker(name)}
              build={(t) =>
                hBarOption(t, {
                  name: 'Weight',
                  cats: report.companyAllocation.map((c) => c.ticker),
                  values: report.companyAllocation.map((c) => c.weight),
                  selectable: true,
                  valueFormat: pct1,
                  axisFormat: (n) => `${n}%`,
                  catTitle: (_c, i) => report.companyAllocation[i].name,
                  rows: (i) => [
                    {
                      label: 'Market value',
                      value: money(report.companyAllocation[i].value),
                    },
                  ],
                })
              }
            />
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
              <h3>
                Gain / loss vs cost
                <ChartInfo text="For each holding, how far its current market value is above or below what you paid, in rupees and percent. Realised sales are not included." />
              </h3>
            </div>
            <span>Unrealised, by company</span>
          </div>
          {report.performance.length ? (
            <>
              <EChart
                className="report-chart"
                height={Math.max(220, report.performance.length * 28 + 40)}
                label={`Gain or loss versus cost by company: ${report.performance
                  .slice(0, 5)
                  .map((p) => `${p.ticker} ${signedPct(p.gainPercent)}`)
                  .join(', ')}.`}
                onPick={({ name }) => openTicker(name)}
                build={(t) =>
                  hBarOption(t, {
                    name: 'Gain / loss',
                    cats: report.performance.map((p) => p.ticker),
                    values: report.performance.map((p) => p.gainPercent),
                    diverging: true,
                    selectable: true,
                    valueFormat: signedPct,
                    axisFormat: (n) =>
                      n === 0 ? '0%' : `${n > 0 ? '+' : '−'}${Math.abs(n)}%`,
                    catTitle: (_c, i) => report.performance[i].name,
                    rows: (i) => [
                      {
                        label: 'Amount',
                        value: signedMoney(report.performance[i].gain),
                        tone: report.performance[i].gain >= 0 ? 'pos' : 'neg',
                      },
                    ],
                  })
                }
              />
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

        <section className="panel report-panel" data-group="performance">
          <div className="report-heading">
            <div>
              <p className="eyebrow">REALISED P&amp;L &amp; TAX</p>
              <h3>
                Realised gains by month
                <ChartInfo text="Profit or loss you locked in by selling, grouped by the month of the sale, with tax shown separately." />
              </h3>
            </div>
            <span>
              Estimated tax (15% filer / 30% non-filer), unless a deduction is
              recorded
            </span>
          </div>
          {realizedActivity.length ? (
            <EChart
              className="report-chart report-chart--trend"
              label={`Realised gains by month, ${realizedActivity.length} months.`}
              build={(t) =>
                barOption(t, {
                  cats: realizedActivity.map((r) => r.label),
                  series: [
                    {
                      name: 'Realised',
                      data: realizedActivity.map((r) => r.net ?? r.gain),
                      color: t.success,
                    },
                  ],
                  bySign: true,
                  valueFormat: signedMoney,
                })
              }
            />
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
              <h3>
                Realised gain / loss by company
                <ChartInfo text="Profit or loss from your recorded sales, grouped by company and ranked by size." />
              </h3>
            </div>
            <span>Net of estimated capital gains tax</span>
          </div>
          {realizedCompanies.length ? (
            <EChart
              className="report-chart"
              height={Math.max(220, realizedCompanies.length * 34 + 40)}
              label={`Realised gain or loss by company: ${realizedCompanies
                .slice(0, 5)
                .map((r) => `${r.ticker} ${signedMoney(r.net ?? r.gain)}`)
                .join(', ')}.`}
              onPick={({ name }) => openTicker(name)}
              build={(t) =>
                hBarOption(t, {
                  name: 'Realised',
                  cats: realizedCompanies.map((r) => r.ticker),
                  values: realizedCompanies.map((r) => r.net ?? r.gain),
                  diverging: true,
                  selectable: true,
                  valueFormat: signedMoney,
                  labelFormat: (n) => compact(n, true),
                  axisFormat: (n) => compact(n),
                  catTitle: (_c, i) => realizedCompanies[i].name,
                  rows: (i) => {
                    const r = realizedCompanies[i];
                    return [
                      {
                        label: r.net === null ? 'Gross' : 'Net',
                        value: signedMoney(r.net ?? r.gain),
                        tone: (r.net ?? r.gain) >= 0 ? 'pos' : 'neg',
                      },
                      ...(r.weight === null
                        ? []
                        : [{ label: 'Share', value: pct1(r.weight) }]),
                    ];
                  },
                })
              }
            />
          ) : (
            <ReportEmpty>Record a sale to see realised gains here.</ReportEmpty>
          )}
          <p className="report-source">
            Source: recorded sales, ranked by absolute gain / loss
          </p>
        </section>
      </div>
    </div>
  );
}

function ReportEmpty({ children }: { children: React.ReactNode }) {
  return <div className="report-empty">{children}</div>;
}
