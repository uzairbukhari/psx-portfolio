'use client';

import { useMemo, type ReactNode } from 'react';
import { Bar, BarChart, Pie, PieChart, XAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { money, moneyShort, type DisplayPart } from '@/lib/portfolio';
import { accountOverview, type AssetClassKey } from '@/lib/account-overview';
import { daysBetween } from '@/lib/performance';
import type { MetalRateRow } from '@/lib/metal-rates';

const CLASS_COLORS: Record<AssetClassKey, string> = {
  stocks: '#3987e5',
  gold: '#c98500',
  silver: '#9aa7b8',
  plans: '#199e70',
  funds: '#9085e9',
};
const SECTOR_COLORS = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
];
const OTHER_COLOR = '#5b6b85';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${moneyShort(Math.abs(n))}`;
const pct = (n: number | null, digits = 1) =>
  n === null ? null : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`;
const tone = (n: number | null) =>
  n === null ? '' : n >= 0 ? 'pos-text' : 'neg-text';
const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });
const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The All portfolios dashboard: what you are worth, where it sits, what it earns. Every figure comes from
 * `accountOverview`, which calculates each portfolio on its own before adding them up.
 */
export default function AccountOverview({
  parts,
  asOf,
  metalRates,
  chart,
  onOpenPortfolio,
  onOpenCompany,
  onSeeAll,
  aside,
}: {
  parts: (DisplayPart & { locked?: boolean })[];
  asOf: string;
  metalRates: MetalRateRow[];
  /** The value-over-time chart, rendered by the page because it loads price history itself. */
  chart: ReactNode;
  onOpenPortfolio: (id: string) => void;
  onOpenCompany: (ticker: string) => void;
  onSeeAll: () => void;
  aside?: ReactNode;
}) {
  const o = useMemo(
    () => accountOverview(parts, asOf, { metalRates }),
    [parts, asOf, metalRates],
  );
  const { total, returns, income } = o;
  const staleDays = total.oldestQuoteDate
    ? daysBetween(total.oldestQuoteDate, asOf)
    : null;
  const sectorData = o.sectors.map((s, i) => ({
    ...s,
    fill:
      s.sector === 'Others' || i >= SECTOR_COLORS.length
        ? OTHER_COLOR
        : SECTOR_COLORS[i],
  }));

  return (
    <div className="overview">
      <section className="panel overview-hero" aria-label="Net worth">
        <div className="overview-hero__main">
          <span className="value-card-label">Net worth · all portfolios</span>
          <strong className="amount overview-hero__value">
            {total.incomplete.length && !total.value
              ? 'Prices needed'
              : moneyShort(total.value)}
          </strong>
          <small>
            {o.portfolios.length} portfolios · {o.holdingCount}{' '}
            {o.holdingCount === 1 ? 'holding' : 'holdings'}
            {total.oldestQuoteDate
              ? ` · oldest price ${dateLabel(total.oldestQuoteDate)}${staleDays && staleDays > 3 ? ' (stale)' : ''}`
              : ''}
          </small>
          {total.incomplete.length > 0 && (
            <output className="overview-incomplete">
              Incomplete: {total.incomplete.join(' ')}
            </output>
          )}
        </div>
        <dl className="overview-stats">
          <div>
            <dt>Invested (remaining cost)</dt>
            <dd className="amount">
              {total.cost === null ? 'Not yet known' : moneyShort(total.cost)}
            </dd>
          </div>
          <div>
            <dt>Gain / loss</dt>
            <dd className={`amount ${tone(total.gain)}`}>
              {total.gain === null ? 'Not yet known' : signed(total.gain)}
              {pct(total.gainPercent) && (
                <small className={tone(total.gain)}>
                  {pct(total.gainPercent)}
                </small>
              )}
            </dd>
          </div>
          <div>
            <dt>Yearly return (includes income)</dt>
            <dd
              className={`amount ${tone(returns.rate === null ? null : returns.rate)}`}
            >
              {returns.rate !== null ? pct(returns.rate * 100) : '—'}
              <small>
                {returns.rate !== null
                  ? 'Money-weighted, after dividends received'
                  : returns.blockedBy
                    ? returns.blockedBy
                    : returns.reason === 'too-short'
                      ? 'Shown after 90 days of history'
                      : 'Not enough history yet'}
              </small>
            </dd>
          </div>
          <div>
            <dt>Dividends this tax year</dt>
            <dd className="amount">
              {moneyShort(income.received)}
              <small>
                {income.expectedCount > 0
                  ? `${moneyShort(income.expected)} more expected (not income yet)`
                  : `Tax year ${income.taxYear}`}
              </small>
            </dd>
          </div>
        </dl>
        {aside && <div className="overview-hero__aside">{aside}</div>}
      </section>

      <div className="overview-grid">
        <section className="panel overview-panel" aria-label="Asset mix">
          <div className="report-heading">
            <div>
              <p className="eyebrow">ASSET MIX</p>
              <h3>Where your money is</h3>
            </div>
            <span>By market value</span>
          </div>
          {total.value > 0 ? (
            <div className="overview-mix">
              <ChartContainer
                config={{ value: { label: 'Market value' } }}
                className="overview-donut"
              >
                <PieChart accessibilityLayer>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        nameKey="label"
                        formatter={(value, _name, item) => (
                          <div className="report-tooltip-row">
                            <span>{item.payload.label}</span>
                            <b>
                              {item.payload.share.toFixed(1)}% ·{' '}
                              {money(Number(value))}
                            </b>
                          </div>
                        )}
                      />
                    }
                  />
                  <Pie
                    data={o.classes.map((c) => ({
                      ...c,
                      fill: CLASS_COLORS[c.key],
                    }))}
                    dataKey="value"
                    nameKey="label"
                    innerRadius="58%"
                    outerRadius="82%"
                    paddingAngle={2}
                  />
                </PieChart>
              </ChartContainer>
              <ul className="overview-classes">
                {o.classes.map((c) => (
                  <li key={c.key}>
                    <i
                      aria-hidden="true"
                      style={{ background: CLASS_COLORS[c.key] }}
                    />
                    <span>
                      {c.label}
                      <small>
                        {c.count} {c.count === 1 ? 'position' : 'positions'}
                        {c.incomplete ? ' · incomplete' : ''}
                      </small>
                    </span>
                    <b className="amount">
                      {moneyShort(c.value)}
                      <small>{c.share.toFixed(1)}%</small>
                    </b>
                    <em className={`amount ${tone(c.gain)}`}>
                      {c.gain === null ? '—' : signed(c.gain)}
                    </em>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="report-empty">
              Add prices to see how your money is spread.
            </p>
          )}
        </section>

        <section className="panel overview-panel" aria-label="Portfolios">
          <div className="report-heading">
            <div>
              <p className="eyebrow">PORTFOLIOS</p>
              <h3>Each portfolio</h3>
            </div>
            <span>Share of net worth</span>
          </div>
          <ul className="overview-portfolios">
            {o.portfolios.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="overview-portfolio"
                  onClick={() => onOpenPortfolio(p.id)}
                >
                  <span className="overview-portfolio__name">
                    <b>{p.name}</b>
                    <small>
                      {p.heldCount} {p.heldCount === 1 ? 'holding' : 'holdings'}
                      {p.locked ? ' · locked' : ''}
                      {p.missingPrice
                        ? ` · ${p.missingPrice} need a price`
                        : ''}
                    </small>
                  </span>
                  <span className="overview-portfolio__value amount">
                    {moneyShort(p.value)}
                    <small className={tone(p.gain)}>
                      {p.gain === null
                        ? 'gain not known'
                        : `${signed(p.gain)}${pct(p.gainPercent) ? ` · ${pct(p.gainPercent)}` : ''}`}
                    </small>
                  </span>
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, p.share)}%` }} />
                  </span>
                  <span className="overview-portfolio__share">
                    {p.share.toFixed(1)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel overview-panel" aria-label="Largest holdings">
        <div className="report-heading">
          <div>
            <p className="eyebrow">STOCKS</p>
            <h3>Largest holdings</h3>
          </div>
          <button
            type="button"
            className="secondary compact"
            onClick={onSeeAll}
          >
            See all {o.holdingCount} companies
          </button>
        </div>
        {o.topHoldings.length ? (
          <ul className="overview-top">
            {o.topHoldings.map((h) => (
              <li key={h.ticker}>
                <button
                  type="button"
                  className="overview-top__row"
                  onClick={() => onOpenCompany(h.ticker)}
                >
                  <span className="overview-top__name">
                    <b className="ticker">{h.ticker}</b>
                    <small>
                      {h.name}
                      {h.portfolios.length > 1
                        ? ` · in ${h.portfolios.length} portfolios`
                        : ` · ${h.portfolios[0]}`}
                    </small>
                  </span>
                  <span className="amount">
                    {moneyShort(h.value)}
                    <small>{h.share.toFixed(1)}% of net worth</small>
                  </span>
                  <span className={`amount ${tone(h.gain)}`}>
                    {h.gain === null ? '—' : signed(h.gain)}
                    {pct(h.gainPercent) && <small>{pct(h.gainPercent)}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="report-empty">No priced holdings yet.</p>
        )}
      </section>

      <div className="overview-grid">
        <section className="panel overview-panel" aria-label="Sectors">
          <div className="report-heading">
            <div>
              <p className="eyebrow">DIVERSIFICATION</p>
              <h3>Stocks by sector</h3>
            </div>
            <span>Across all portfolios</span>
          </div>
          {sectorData.length ? (
            <ul className="overview-sectors">
              {sectorData.map((s) => (
                <li key={s.sector}>
                  <span>
                    <i aria-hidden="true" style={{ background: s.fill }} />
                    {s.sector}
                  </span>
                  <span className="bar" aria-hidden="true">
                    <i
                      style={{
                        width: `${Math.min(100, s.share)}%`,
                        background: s.fill,
                      }}
                    />
                  </span>
                  <b className="amount">{s.share.toFixed(1)}%</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="report-empty">
              Add prices and sectors to see the split.
            </p>
          )}
        </section>

        <section className="panel overview-panel" aria-label="Income">
          <div className="report-heading">
            <div>
              <p className="eyebrow">INCOME</p>
              <h3>Dividends received</h3>
            </div>
            <span>Last 12 months</span>
          </div>
          {income.months.some((m) => m.amount > 0) ? (
            <ChartContainer
              config={{
                amount: { label: 'Received', color: 'var(--primary)' },
              }}
              className="overview-income"
            >
              <BarChart
                data={income.months}
                margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
              >
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={monthLabel}
                  interval={0}
                  fontSize={11}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_l, items) =>
                        String(items?.[0]?.payload?.month ?? '')
                      }
                      formatter={(value) => <b>{money(Number(value))}</b>}
                    />
                  }
                />
                <Bar dataKey="amount" fill="var(--primary)" radius={3} />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="report-empty">
              No dividends received in the last 12 months.
            </p>
          )}
          <p className="report-source">
            {money(income.receivedTotal)} received in total. Expected dividends
            are a plan and stay out of income until you confirm them.
          </p>
        </section>
      </div>

      <section className="panel overview-panel" aria-label="Value over time">
        {chart}
      </section>
    </div>
  );
}
