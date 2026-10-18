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
import { daysBetween } from '@/lib/performance';
import type { FxRateRow } from '@/lib/fx-rates';
import type { MetalRateRow } from '@/lib/metal-rates';
import type { MarketGlance } from './use-market-glance';

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

/** The index as a small line; no axes, the card carries the numbers. */
function KseSpark({ points, up }: { points: { value: number }[]; up: boolean }) {
  if (points.length < 2) return <div className="glance-spark" />;
  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const range = Math.max(...values) - lo || 1;
  const coords = points.map(
    (p, i) => `${((i / (points.length - 1)) * 300).toFixed(1)},${(56 - ((p.value - lo) / range) * 50 - 3).toFixed(1)}`,
  );
  return (
    <svg className="glance-spark" viewBox="0 0 300 56" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,56 ${coords.join(' ')} 300,56`} className={up ? 'area up' : 'area down'} />
      <polyline points={coords.join(' ')} className={up ? 'line up' : 'line down'} fill="none" />
    </svg>
  );
}

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
  compact = false,
  scopeName = 'all portfolios',
  glance,
  today,
  toCheck,
  sip,
  onOpenPlan,
  onFix,
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
  /** One portfolio: the hero and the three cards only, without the All dashboard's breakdown panels. */
  compact?: boolean;
  scopeName?: string;
  glance: MarketGlance;
  /** What the stocks held moved today, from the public day change; null until prices are in. */
  today: { amount: number; percent: number } | null;
  /** Holdings whose cost is unknown. */
  toCheck: number;
  sip: { label: string; fresh: number; put: number };
  onOpenPlan: () => void;
  onFix: () => void;
}) {
  const o = useMemo(
    () => accountOverview(parts, asOf, { metalRates, fundNavs, planNavs, fxRates }),
    [parts, asOf, metalRates, fundNavs, planNavs, fxRates],
  );
  const { total, returns, income, invested } = o;
  const sipShare = Math.min(100, (sip.put / Math.max(1, sip.fresh)) * 100);
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
      <section className="slab hero-slab" aria-label="Net worth">
        <div className="hero-left">
          <span className="lbl">
            Net worth · {compact ? scopeName : 'all portfolios'}
          </span>
          <div className="hero-figure num">
            {total.incomplete.length && !total.value ? (
              <span className="hero-pending">Prices needed</span>
            ) : (
              <>
                <span className="rs">Rs</span>{' '}
                {Math.round(total.value).toLocaleString('en-PK')}
              </>
            )}
          </div>
          <div className="hero-pills">
            {total.gain !== null && (
              <>
                <span className={`pill ${total.gain >= 0 ? 'g' : 'l'}`}>
                  {total.gain >= 0 ? '▲' : '▼'} {moneyShort(Math.abs(total.gain))}
                </span>
                {pct(total.gainPercent) && (
                  <span className={`pill ${total.gain >= 0 ? 'g' : 'l'}`}>
                    {pct(total.gainPercent)}
                  </span>
                )}
                <span className="hero-note">on what you hold</span>
              </>
            )}
          </div>
          {today && (
            <div className="hero-pills">
              <span className={`pill ${today.amount >= 0 ? 'g' : 'l'}`}>
                {today.amount >= 0 ? '▲' : '▼'} {moneyShort(Math.abs(today.amount))} ·{' '}
                {Math.abs(today.percent).toFixed(2)}%
              </span>
              <span className="hero-note">today</span>
            </div>
          )}
          <small className="hero-scope">
            {compact
              ? `${o.holdingCount} ${o.holdingCount === 1 ? 'holding' : 'holdings'}`
              : `${o.portfolios.length} portfolios · ${o.holdingCount} ${o.holdingCount === 1 ? 'holding' : 'holdings'}`}
            {total.oldestQuoteDate
              ? ` · oldest price ${dateLabel(total.oldestQuoteDate)}${staleDays && staleDays > 3 ? ' (stale)' : ''}`
              : ''}
          </small>
          {total.incomplete.length > 0 && (
            <output className="overview-incomplete">
              Incomplete: {total.incomplete.join(' ')}
            </output>
          )}
          <dl className="hero-stats">
            <div>
              <dt className="lbl">Invested</dt>
              <dd className="num">
                {total.cost === null ? 'Not yet known' : moneyShort(total.cost)}
              </dd>
            </div>
            <div>
              <dt className="lbl">Yearly return</dt>
              <dd
                className={`num ${returns.rate === null ? '' : returns.rate >= 0 ? 'hero-gain' : 'hero-loss'}`}
                title={
                  returns.rate === null
                    ? (returns.blockedBy ??
                      (returns.reason === 'too-short'
                        ? 'Shown after 90 days of history'
                        : 'Not enough history yet'))
                    : 'Money-weighted, after dividends received'
                }
              >
                {returns.rate !== null ? pct(returns.rate * 100) : '—'}
              </dd>
            </div>
            <div>
              <dt className="lbl">Dividends, tax year</dt>
              <dd className="num">{moneyShort(income.received)}</dd>
              {income.expectedCount > 0 && (
                <small>{moneyShort(income.expected)} more expected</small>
              )}
            </div>
            <div>
              <dt className="lbl">To check</dt>
              <dd>
                {toCheck > 0 ? (
                  <button
                    type="button"
                    data-slot="chip"
                    className="hero-chip warn"
                    onClick={onFix}
                  >
                    {toCheck} {toCheck === 1 ? 'cost' : 'costs'} missing · Fix
                  </button>
                ) : (
                  <span className="hero-chip ok">All costs known</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
        <div className="hero-right">{hasStocks ? chart : null}</div>
      </section>

      <div className="glance-row">
        <section className="card glance-sip" aria-label="This month">
          <svg className="sip-ring" viewBox="0 0 104 104" aria-hidden="true">
            <circle cx="52" cy="52" r="44" className="ring-track" />
            <circle
              cx="52"
              cy="52"
              r="44"
              className="ring-fill"
              strokeDasharray={`${(2 * Math.PI * 44 * sipShare) / 100} ${2 * Math.PI * 44}`}
              transform="rotate(-90 52 52)"
            />
            <text x="52" y="58" textAnchor="middle" className="ring-text">
              {Math.round(sipShare)}%
            </text>
          </svg>
          <div>
            <span className="lbl">{sip.label} SIP</span>
            <div className="num glance-big">{money(sip.put).replace(/\.\d+$/, '')}</div>
            <small>of {money(sip.fresh).replace(/\.\d+$/, '')} planned</small>
            <button type="button" data-slot="link" className="sw-link" onClick={onOpenPlan}>
              Open the plan →
            </button>
          </div>
        </section>
        <section className="card glance-kse" aria-label="KSE-100">
          <div className="between">
            <span className="lbl">
              KSE-100{glance.market ? ` · ${glance.market.label}` : ''}
            </span>
            {glance.index && (
              <span className={`pill ${glance.index.change >= 0 ? 'g' : 'l'}`}>
                {glance.index.change >= 0 ? '+' : '−'}
                {Math.abs(glance.index.change).toLocaleString('en-PK', { maximumFractionDigits: 2 })} ·{' '}
                {Math.abs(glance.index.changePercent).toFixed(2)}%
              </span>
            )}
          </div>
          <div className="num glance-big">
            {glance.index
              ? glance.index.close.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : '—'}
          </div>
          <KseSpark points={glance.series} up={(glance.index?.change ?? 0) >= 0} />
          {glance.breadth && glance.breadth.covered > 0 && (
            <>
              <div className="breadth-bar" aria-hidden="true">
                <i className="up" style={{ flex: glance.breadth.advances }} />
                <i className="flat" style={{ flex: glance.breadth.unchanged }} />
                <i className="down" style={{ flex: glance.breadth.declines }} />
              </div>
              <div className="between num breadth-legend">
                <span className="hero-gain">{glance.breadth.advances} up</span>
                <span>{glance.breadth.unchanged} flat</span>
                <span className="hero-loss">{glance.breadth.declines} down</span>
              </div>
            </>
          )}
        </section>
        <section className="card glance-pf" aria-label="Portfolios">
          <ul className="overview-portfolios">
            {o.portfolios.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="overview-portfolio" data-slot="portfolio"
                  onClick={() => onOpenPortfolio(p.id)}
                >
                  <span className="overview-portfolio__top">
                    <i className="pf-avatar" aria-hidden="true">
                      {p.name.slice(0, 1).toUpperCase()}
                    </i>
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
      </div>

      {!compact && (
        <>
      <div className="overview-grid" data-cols={hasStocks ? 2 : 3}>
        <section className="panel overview-panel" aria-label="Asset mix">
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


        <section className="panel overview-panel" aria-label="Invested">
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
            {money(invested.total)} invested in the last 12 months · dividends
            received {money(income.receivedTotal)}
          </p>
        </section>
      </div>
        </>
      )}
    </div>
  );
}
