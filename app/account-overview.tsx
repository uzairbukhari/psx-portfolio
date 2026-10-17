'use client';

import type { FundNavRow } from '@/lib/mufap';
import type { PlanNavRow } from '@/lib/plans';
import { useMemo, type ReactNode } from 'react';
import { EChart } from './charts/echart';
import { barOption, donutOption, type ChartTokens } from '@/lib/chart-kit';
import { money, moneyShort, type DisplayPart } from '@/lib/portfolio';
import {
  accountOverview,
  ASSET_CLASS_LABELS,
  type AssetClassKey,
} from '@/lib/account-overview';
import { ChartInfo } from './chart-info';
import { daysBetween } from '@/lib/performance';
import type { FxRateRow } from '@/lib/fx-rates';
import type { MetalRateRow } from '@/lib/metal-rates';

/** The same colours as CLASS_COLORS, resolved for the canvas. */
const classColor = (t: ChartTokens, k: AssetClassKey) =>
  ({
    stocks: t.cat[0],
    gold: t.cat[3],
    silver: t.neutral,
    plans: t.cat[2],
    funds: t.cat[6],
    currency: t.cat[5],
  })[k];

const CLASS_COLORS: Record<AssetClassKey, string> = {
  stocks: 'var(--cat-1)',
  gold: 'var(--cat-4)',
  silver: 'var(--chart-neutral)',
  plans: 'var(--cat-3)',
  funds: 'var(--cat-7)',
  currency: 'var(--cat-6)',
};
const SECTOR_COLORS = [
  'var(--cat-1)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-4)',
  'var(--cat-5)',
  'var(--cat-6)',
  'var(--cat-7)',
];
const investedKeys: AssetClassKey[] = [
  'stocks',
  'funds',
  'plans',
  'gold',
  'silver',
];
const OTHER_COLOR = 'var(--chart-other)';

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
  fundNavs = [],
  planNavs = [],
  fxRates = [],
  chart,
  onOpenPortfolio,
}: {
  parts: (DisplayPart & { locked?: boolean })[];
  asOf: string;
  metalRates: MetalRateRow[];
  fundNavs?: FundNavRow[];
  planNavs?: PlanNavRow[];
  fxRates?: FxRateRow[];
  /** The stocks value chart (with the market pulse beside it), rendered by the page because it loads price history itself. Only shown when stocks are held. */
  chart: ReactNode;
  onOpenPortfolio: (id: string) => void;
}) {
  const o = useMemo(
    () => accountOverview(parts, asOf, { metalRates, fundNavs, planNavs, fxRates }),
    [parts, asOf, metalRates, fundNavs, planNavs, fxRates],
  );
  const { total, returns, income, invested } = o;
  const staleDays = total.oldestQuoteDate
    ? daysBetween(total.oldestQuoteDate, asOf)
    : null;
  // No PSX stocks held: the market pulse, the stocks chart and the sector split have nothing to show.
  const hasStocks = o.classes.some((c) => c.key === 'stocks');
  const sectorData = o.sectors.map((s, i) => ({
    ...s,
    fill:
      s.sector === 'Others' || s.sector === 'Other' || i >= SECTOR_COLORS.length
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
                  : income.received > 0 || income.receivedTotal === 0
                    ? `Tax year ${income.taxYear}`
                    : income.unknownDateCount > 0
                      ? `${income.unknownDateCount} received without a payment date, not counted · add the date to include`
                      : `None paid in tax year ${income.taxYear} (from 1 July) · ${moneyShort(income.receivedPrevious)} in ${income.previousTaxYear}`}
              </small>
            </dd>
          </div>
        </dl>
      </section>

      {hasStocks && (
        <section
          className="panel overview-panel overview-market"
          aria-label="Stocks and market"
        >
          {chart}
        </section>
      )}

      <div className="overview-grid" data-cols={hasStocks ? 2 : 3}>
        <section className="panel overview-panel" aria-label="Asset mix">
          <div className="report-heading">
            <div>
              <p className="eyebrow">ASSET MIX</p>
              <h3>
                Where your money is
                <ChartInfo text="Your net worth split by kind of asset: stocks, mutual funds, gold, silver and savings plans, at current value." />
              </h3>
            </div>
            <span>By market value</span>
          </div>
          {total.value > 0 ? (
            <div className="overview-mix">
              <EChart
                className="overview-donut"
                label={`Asset mix: ${o.classes.map((c) => `${c.label} ${c.share.toFixed(1)}%`).join(', ')}.`}
                build={(t) =>
                  donutOption(t, {
                    centerTitle: 'Net worth',
                    slices: o.classes.map((c) => ({
                      name: c.label,
                      value: c.value,
                      color: classColor(t, c.key),
                    })),
                    valueFormat: money,
                    centerFormat: (n) => money(Math.round(n)).replace(/\.\d+$/, ''),
                  })
                }
              />
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

        {hasStocks && (
          <section className="panel overview-panel" aria-label="Sectors">
            <div className="report-heading">
              <div>
                <p className="eyebrow">DIVERSIFICATION</p>
                <h3>
                  Stocks by sector
                  <ChartInfo text="How the value of your PSX stocks is spread across sectors. The five largest sectors are shown; the rest are grouped as Other." />
                </h3>
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
        )}
        <section className="panel overview-panel" aria-label="Portfolios">
          <div className="report-heading">
            <div>
              <p className="eyebrow">PORTFOLIOS</p>
              <h3>
                Each portfolio
                <ChartInfo text="What each of your portfolios is worth and its share of the total." />
              </h3>
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
                  <span className="overview-portfolio__top">
                    <b>{p.name}</b>
                    <span className="overview-portfolio__share">
                      {p.share.toFixed(1)}%
                    </span>
                  </span>
                  <span className="overview-portfolio__value amount">
                    {moneyShort(p.value)}
                  </span>
                  <span className={`overview-portfolio__gain ${tone(p.gain)}`}>
                    {p.gain === null
                      ? 'Gain not known'
                      : `${signed(p.gain)}${pct(p.gainPercent) ? ` · ${pct(p.gainPercent)}` : ''}`}
                  </span>
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, p.share)}%` }} />
                  </span>
                  <small>
                    {p.heldCount} {p.heldCount === 1 ? 'holding' : 'holdings'}
                    {p.locked ? ' · locked' : ''}
                    {p.missingPrice ? ` · ${p.missingPrice} need a price` : ''}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel overview-panel" aria-label="Invested">
          <div className="report-heading">
            <div>
              <p className="eyebrow">INVESTING</p>
              <h3>
                Invested per month
                <ChartInfo text="Money you put in each month over the last 12 months: stock buys, fund and plan payments and gold or silver purchases. Sales and redemptions are not subtracted." />
              </h3>
            </div>
            <span>Last 12 months</span>
          </div>
          {invested.months.some((m) => m.amount > 0) ? (
            <EChart
              className="overview-income"
              label={`Invested per month, last 12 months, ${money(invested.total)} in total.`}
              build={(t) =>
                barOption(t, {
                  cats: invested.months.map((m) => monthLabel(m.month)),
                  catTitle: (c) => c,
                  stack: true,
                  legend: true,
                  series: investedKeys.map((k) => ({
                    name: ASSET_CLASS_LABELS[k],
                    data: invested.months.map(
                      (m) => Number((m as Record<string, unknown>)[k]) || 0,
                    ),
                    color: classColor(t, k),
                  })),
                  valueFormat: money,
                })
              }
            />
          ) : (
            <p className="report-empty">
              Nothing invested in the last 12 months.
            </p>
          )}
          <p className="report-source">
            {money(invested.total)} invested in the last 12 months. Counts money
            put in across every portfolio: stock buys (with fees), fund and plan
            payments, and gold and silver purchases. Sales and redemptions are
            not subtracted. Dividends are in the Income panel (
            {money(income.receivedTotal)} received in total).
          </p>
        </section>
      </div>
    </div>
  );
}
