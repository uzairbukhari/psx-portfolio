'use client';

import { useState } from 'react';
import { EChart } from './charts/echart';
import { barOption, compact, timeSeriesOption } from '@/lib/chart-kit';
import { money, moneyShort, today, type Portfolio } from '@/lib/portfolio';
import {
  fundReport,
  planReport,
  metalReport,
  type MonthPoint,
  type ReportMode,
} from '@/lib/asset-reports';
import type { Metal, MetalRateRow } from '@/lib/metal-rates';
import type { FundNavRow } from '@/lib/mufap';
import type { PlanNavRow } from '@/lib/plans';
import type { Asset } from '@/lib/assets';
import { ChartInfo } from './chart-info';
import PortfolioReports from './portfolio-reports';

// Same fixed hue order as the stock reports (validated on the dark surface).
const colors = [
  'var(--cat-1)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-4)',
  'var(--cat-5)',
  'var(--cat-6)',
  'var(--cat-7)',
];
const OTHER = 'var(--chart-other)';
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PK', {
    month: 'short',
    year: '2-digit',
  }).format(new Date(y, m - 1, 1));
};
const dayLabel = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PK', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  }).format(new Date(y, m - 1, day));
};
const signed = (n: number) => `${n >= 0 ? '+' : ''}${moneyShort(n)}`;

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="report-empty">{children}</div>;
}

function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: 'pos' | 'neg' | '';
}) {
  return (
    <div className={`reports-priced-value ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function MonthlyBars({
  rows,
  eyebrow,
  source,
}: {
  rows: (MonthPoint & { label: string })[];
  eyebrow: string;
  source: string;
}) {
  return (
    <section className="panel report-panel">
      <div className="report-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>
            Monthly purchase activity
            <ChartInfo text="How much you bought in each calendar month, including fees. Opening balances and sales are left out." />
          </h3>
        </div>
        <span>PKR invested, including fees</span>
      </div>
      {rows.length ? (
        <EChart
          className="report-chart report-chart--activity"
          label={`Monthly purchase activity, ${rows.length} months.`}
          build={(t) =>
            barOption(t, {
              cats: rows.map((r) => r.label),
              series: [
                {
                  name: 'Invested',
                  data: rows.map((r) => r.invested),
                  color: t.primary,
                },
              ],
              valueFormat: money,
            })
          }
        />
      ) : (
        <Empty>Record purchases to see monthly investment activity.</Empty>
      )}
      <p className="report-source">{source}</p>
    </section>
  );
}

function Trajectory({
  rows,
  total,
  eyebrow,
  source,
}: {
  rows: (MonthPoint & { label: string })[];
  total: number;
  eyebrow: string;
  source: string;
}) {
  return (
    <section className="panel report-panel">
      <div className="report-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>
            Cumulative invested
            <ChartInfo text="Running total of everything you have paid in, month by month. Opening balances and sales are left out." />
          </h3>
        </div>
        <span>{rows.length ? money(total) : '—'} to date</span>
      </div>
      {rows.length ? (
        <EChart
          className="report-chart report-chart--trend"
          label={`Cumulative invested by month, ${money(total)} to date.`}
          build={(t) =>
            timeSeriesOption(t, {
              name: 'Cumulative invested',
              data: rows.map((r) => ({ x: r.label, y: r.cumulative })),
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
        <Empty>Record purchases to see your contribution trajectory.</Empty>
      )}
      <p className="report-source">{source}</p>
    </section>
  );
}

function FundReports({
  portfolio,
  navs,
}: {
  portfolio: Portfolio;
  navs: FundNavRow[];
}) {
  const report = fundReport(portfolio.assets ?? [], navs, today());
  const rows = report.monthly.map((m) => ({
    ...m,
    label: monthLabel(m.month),
  }));
  // Top seven funds by amount invested keep their own colour; the rest fold into "Other".
  const shown = report.funds.filter((f) => f.invested > 0).slice(0, 7);
  const shownIds = new Set(shown.map((f) => f.id));
  const hasOther = report.funds.some(
    (f) => f.invested > 0 && !shownIds.has(f.id),
  );
  const stacked = rows.map((m) => {
    const row: Record<string, number | string> = { label: m.label };
    for (const f of shown) row[f.id] = m.byAsset[f.id] ?? 0;
    if (hasOther)
      row.other = Object.entries(m.byAsset)
        .filter(([id]) => !shownIds.has(id))
        .reduce((t, [, v]) => t + v, 0);
    return row;
  });
  const keys = [
    ...shown.map((f, i) => ({ id: f.id, name: f.name, color: colors[i] })),
    ...(hasOther ? [{ id: 'other', name: 'Other funds', color: OTHER }] : []),
  ];
  const last = rows.at(-1);
  return (
    <>
      <div className="reports-intro">
        <div className="reports-intro-header">
          <p className="eyebrow">MUTUAL FUND REPORTS</p>
          <p>
            How much you put into your funds, when, and where. Value uses each
            fund’s latest repurchase price.
          </p>
        </div>
        <div className="reports-hero-stats">
          <Stat
            label="Invested"
            value={moneyShort(report.invested)}
            note="Purchases, including fees"
          />
          <Stat
            label="Current value"
            value={report.value === null ? '—' : moneyShort(report.value)}
            note="Units × latest repurchase price"
          />
          <Stat
            label="Unrealised gain / loss"
            value={report.gain === null ? '—' : signed(report.gain)}
            note="Value less remaining cost"
            tone={report.gain === null ? '' : report.gain >= 0 ? 'pos' : 'neg'}
          />
          <Stat
            label="Dividends received"
            value={moneyShort(report.dividends)}
            note="Cash and reinvested dividends recorded"
          />
        </div>
      </div>
      <div className="reports-grid" style={{ marginBottom: 20 }}>
        <Trajectory
          rows={rows}
          total={last?.cumulative ?? 0}
          eyebrow="SIP TRAJECTORY"
          source="Source: running total of non-voided fund purchases · opening balances, reinvested dividends and redemptions excluded"
        />
        <MonthlyBars
          rows={rows}
          eyebrow="CONTRIBUTION RHYTHM"
          source="Source: non-voided fund purchases · opening balances and redemptions excluded"
        />
        <section className="panel report-panel report-panel--wide">
          <div className="report-heading">
            <div>
              <p className="eyebrow">SIP ACTIVITY</p>
              <h3>
                Monthly investment by fund
                <ChartInfo text="Your monthly purchases split by fund, so you can see where each month goes." />
              </h3>
            </div>
            <span>{money(report.invested)} invested</span>
          </div>
          {keys.length ? (
            <>
              <EChart
                className="report-chart report-chart--medium"
                label={`Monthly investment by fund, ${money(report.invested)} in total.`}
                build={(t) =>
                  barOption(t, {
                    cats: stacked.map((r) => String(r.label)),
                    stack: true,
                    legend: true,
                    legendSuffix: Object.fromEntries(
                      keys.map((k) => {
                        const f = report.funds.find((x) => x.id === k.id);
                        const amount = f
                          ? f.invested
                          : report.funds
                              .filter((x) => !shownIds.has(x.id))
                              .reduce((tot, x) => tot + x.invested, 0);
                        return [k.name, moneyShort(amount)];
                      }),
                    ),
                    series: keys.map((k, i) => ({
                      name: k.name,
                      data: stacked.map((r) => Number(r[k.id]) || 0),
                      color:
                        k.id === 'other' ? t.other : t.cat[i % t.cat.length],
                    })),
                    valueFormat: money,
                  })
                }
              />
            </>
          ) : (
            <Empty>Record fund purchases to see where each month went.</Empty>
          )}
          <p className="report-source">Source: non-voided purchases by fund</p>
        </section>
      </div>
    </>
  );
}

function PlanReports({
  portfolio,
  navs,
}: {
  portfolio: Portfolio;
  navs: PlanNavRow[];
}) {
  const report = planReport(portfolio.assets ?? [], navs, today());
  const rows = report.monthly.map((m) => ({
    ...m,
    label: monthLabel(m.month),
  }));
  const series = report.series.map((s) => ({
    ...s,
    label: monthLabel(s.month),
  }));
  return (
    <>
      <div className="reports-intro">
        <div className="reports-intro-header">
          <p className="eyebrow">SAVINGS PLAN REPORTS</p>
          <p>
            What you paid into your savings plans against what they are worth.
            Values come from your dated statements, moved by the plan’s unit
            price or your assumed rate in between.
          </p>
        </div>
        <div className="reports-hero-stats">
          <Stat
            label="Paid in"
            value={moneyShort(report.paidIn)}
            note="All contributions"
          />
          <Stat
            label="Current value"
            value={moneyShort(report.value)}
            note="Latest statement, adjusted since"
          />
          <Stat
            label="Gain / loss"
            value={signed(report.gain)}
            note="Value plus redeemed, less paid in"
            tone={report.gain >= 0 ? 'pos' : 'neg'}
          />
          <Stat
            label="Redeemed"
            value={moneyShort(report.redeemed)}
            note="Cash taken out"
          />
        </div>
      </div>
      <div className="reports-grid" style={{ marginBottom: 20 }}>
        <section className="panel report-panel report-panel--wide">
          <div className="report-heading">
            <div>
              <p className="eyebrow">PLAN GROWTH</p>
              <h3>
                Paid in against value
                <ChartInfo text="What you have paid into the plan over time against its current value; the gap is the profit the plan has added." />
              </h3>
            </div>
            <span>Month-end</span>
          </div>
          {series.length ? (
            <EChart
              className="report-chart report-chart--medium"
              label={`Plan paid in against value, ${series.length} months. Latest value ${money(series.at(-1)!.value)}.`}
              build={(t) =>
                timeSeriesOption(t, {
                  name: 'Value',
                  data: series.map((p) => ({ x: p.label, y: p.value })),
                  extra: [
                    {
                      name: 'Paid in',
                      data: series.map((p) => p.paidIn),
                      color: t.neutral,
                      dashed: true,
                    },
                  ],
                  categorical: true,
                  area: true,
                  zoom: false,
                  valueFormat: money,
                  dateLabel: (x) => String(x),
                  rows: (i) => [
                    {
                      label: 'Paid in',
                      value: money(series[i].paidIn),
                      tone: 'muted',
                    },
                  ],
                })
              }
            />
          ) : (
            <Empty>Record contributions to see how your plan grows.</Empty>
          )}
          <p className="report-source">
            Source: contributions and statement values · dashed line is what you
            paid in
          </p>
        </section>
        <Trajectory
          rows={rows}
          total={rows.at(-1)?.cumulative ?? 0}
          eyebrow="SIP TRAJECTORY"
          source="Source: running total of non-voided plan contributions"
        />
        <MonthlyBars
          rows={rows}
          eyebrow="CONTRIBUTION RHYTHM"
          source="Source: non-voided plan contributions · redemptions excluded"
        />
      </div>
    </>
  );
}

const RANGES = [
  ['1Y', 365],
  ['3Y', 1095],
  ['5Y', 1825],
] as const;

function MetalReports({
  portfolio,
  metal,
  rates,
}: {
  portfolio: Portfolio;
  metal: Metal;
  rates: MetalRateRow[];
}) {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('5Y');
  const asOf = today();
  const report = metalReport(portfolio.assets ?? [], metal, rates, asOf);
  const name = metal === 'gold' ? 'Gold' : 'Silver';
  const days = RANGES.find(([k]) => k === range)![1];
  const from = new Date(Date.parse(`${asOf}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const history = report.history.filter((p) => p.date >= from);
  const rows = report.monthly.map((m) => ({
    ...m,
    label: monthLabel(m.month),
  }));
  const avg = report.averageCostPerTola;
  return (
    <>
      <div className="reports-intro">
        <div className="reports-intro-header">
          <p className="eyebrow">{name.toUpperCase()} REPORTS</p>
          <p>
            The {name.toLowerCase()} price over time against what you paid.
            Prices are per tola of pure metal; the dealer rate is used where
            recorded, otherwise the world price in rupees.
          </p>
        </div>
        <div className="reports-hero-stats">
          <Stat
            label="Held"
            value={`${report.grams.toFixed(2)} g`}
            note={`${(report.grams / 11.6638).toFixed(2)} tola`}
          />
          <Stat
            label="Current value"
            value={report.value === null ? '—' : moneyShort(report.value)}
            note={
              report.latest
                ? `Rate of ${dayLabel(report.latest.date)}`
                : 'No rate loaded yet'
            }
          />
          <Stat
            label="Average cost"
            value={avg === null ? '—' : `${moneyShort(avg)} / tola`}
            note={
              avg === null
                ? 'Needs a cost on every purchase'
                : 'Pure metal, all purchases'
            }
          />
          <Stat
            label="Unrealised gain / loss"
            value={report.gain === null ? '—' : signed(report.gain)}
            note="Value less remaining cost"
            tone={report.gain === null ? '' : report.gain >= 0 ? 'pos' : 'neg'}
          />
        </div>
      </div>
      <div className="reports-grid" style={{ marginBottom: 20 }}>
        <section className="panel report-panel report-panel--wide">
          <div className="report-heading">
            <div>
              <p className="eyebrow">{name.toUpperCase()} RATE</p>
              <h3>
                Rate history against your average cost
                <ChartInfo text="The saved market rate over time, with a dashed line at your average cost per tola of pure metal. Above the line, your holding is in profit." />
              </h3>
            </div>
            <div className="reports-tabs seg" aria-label="Range">
              {RANGES.map(([k]) => (
                <button
                  key={k}
                  type="button"
                  data-active={range === k || undefined}
                  onClick={() => setRange(k)}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          {history.length > 1 ? (
            <EChart
              className="report-chart report-chart--medium"
              label={`${name} rate per tola, ${range}. Latest ${money(history.at(-1)!.rate)}.`}
              build={(t) =>
                timeSeriesOption(t, {
                  name: `${name} rate`,
                  data: history.map((p) => ({ x: p.date, y: p.rate })),
                  area: true,
                  valueFormat: money,
                  axisFormat: compact,
                  dateLabel: (x, _long, tip) =>
                    tip
                      ? dayLabel(String(x))
                      : monthLabel(String(x).slice(0, 7)),
                  refLines:
                    avg !== null
                      ? [
                          {
                            y: avg,
                            color: t.warn,
                            label: `Your average cost ${moneyShort(avg)}`,
                          },
                        ]
                      : undefined,
                  rows: (i) => [
                    {
                      label: 'Source',
                      value:
                        history[i].kind === 'local'
                          ? 'Dealer rate'
                          : 'World price in rupees',
                      tone: 'muted',
                    },
                  ],
                })
              }
            />
          ) : (
            <Empty>
              Not enough rate history yet. A point is saved each day the rates
              are collected.
            </Empty>
          )}
          <p className="report-source">
            Source: saved {name.toLowerCase()} rates (
            {history.length
              ? `${dayLabel(history[0].date)} to ${dayLabel(history.at(-1)!.date)}`
              : 'none yet'}
            ) · dashed line is your average cost per tola of pure metal
          </p>
        </section>
        <Trajectory
          rows={rows}
          total={rows.at(-1)?.cumulative ?? 0}
          eyebrow="CUMULATIVE PURCHASES"
          source={`Source: running total of non-voided ${name.toLowerCase()} purchases · opening balances and sales excluded`}
        />
        <MonthlyBars
          rows={rows}
          eyebrow="CONTRIBUTION RHYTHM"
          source={`Source: non-voided ${name.toLowerCase()} purchases · opening balances and sales excluded`}
        />
      </div>
    </>
  );
}

export default function AssetReports({
  portfolio,
  mode,
  metalRates,
  fundNavs,
  planNavs,
}: {
  portfolio: Portfolio;
  mode: Exclude<ReportMode, 'stocks'>;
  metalRates: MetalRateRow[];
  fundNavs: FundNavRow[];
  planNavs: PlanNavRow[];
}) {
  const metals = (['gold', 'silver'] as const).filter((m) =>
    portfolio.assets?.some((a) => a.kind === 'metal' && a.metal === m),
  );
  const classes: { key: string; label: string; node: React.ReactNode }[] = [];
  if (mode === 'savings') {
    if (portfolio.assets?.some((a) => a.kind === 'fund'))
      classes.push({
        key: 'fund',
        label: 'Mutual fund',
        node: <FundReports portfolio={portfolio} navs={fundNavs} />,
      });
    if (portfolio.assets?.some((a) => a.kind === 'plan'))
      classes.push({
        key: 'plan',
        label: 'Savings plan',
        node: <PlanReports portfolio={portfolio} navs={planNavs} />,
      });
  } else {
    for (const m of metals)
      classes.push({
        key: m,
        label: m === 'gold' ? 'Gold' : 'Silver',
        node: (
          <MetalReports portfolio={portfolio} metal={m} rates={metalRates} />
        ),
      });
  }
  const [picked, setPicked] = useState('');
  const current = classes.find((c) => c.key === picked) ?? classes[0];
  return (
    <div className="reports">
      {classes.length > 1 && (
        <div className="reports-tabs seg" aria-label="Asset type">
          {classes.map((c) => (
            <button
              key={c.key}
              type="button"
              data-active={c.key === current.key || undefined}
              onClick={() => setPicked(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {current?.node}
    </div>
  );
}

/** The All workspace: one switcher over stocks, metals and mutual funds / plans, built from every portfolio's holdings. */
export function AllReports({
  portfolio,
  assets,
  metalRates,
  fundNavs,
  planNavs,
}: {
  portfolio: Portfolio;
  assets: Asset[];
  metalRates: MetalRateRow[];
  fundNavs: FundNavRow[];
  planNavs: PlanNavRow[];
}) {
  const [view, setView] = useState<'all' | 'stocks' | 'metals' | 'funds'>(
    'all',
  );
  const merged: Portfolio = { ...portfolio, assets };
  const has = {
    stocks:
      portfolio.trades.some((t) => !t.voided) ||
      !!portfolio.dividends?.some((d) => !d.voided),
    metals: assets.some((a) => a.kind === 'metal'),
    funds: assets.some((a) => a.kind === 'fund' || a.kind === 'plan'),
  };
  const kinds = (['stocks', 'metals', 'funds'] as const).filter((k) => has[k]);
  const labels = {
    all: 'All',
    stocks: 'Stocks',
    metals: 'Metals',
    funds: 'Mutual Funds',
  };
  const show = (k: 'stocks' | 'metals' | 'funds') =>
    kinds.length === 1 || view === 'all' || view === k;
  const section = (k: 'stocks' | 'metals' | 'funds') =>
    !has[k] || !show(k) ? null : k === 'stocks' ? (
      <PortfolioReports key={k} portfolio={merged} />
    ) : (
      <AssetReports
        key={k}
        portfolio={merged}
        mode={k === 'metals' ? 'metal' : 'savings'}
        metalRates={metalRates}
        fundNavs={fundNavs}
        planNavs={planNavs}
      />
    );
  if (!kinds.length) return <PortfolioReports portfolio={portfolio} />;
  return (
    <div>
      {kinds.length > 1 && (
        <div
          className="reports-tabs seg"
          aria-label="Asset type"
          style={{ marginBottom: 20 }}
        >
          {(['all', ...kinds] as const).map((k) => (
            <button
              key={k}
              type="button"
              data-active={view === k || undefined}
              onClick={() => setView(k)}
            >
              {labels[k]}
            </button>
          ))}
        </div>
      )}
      {section('stocks')}
      {section('metals')}
      {section('funds')}
    </div>
  );
}
