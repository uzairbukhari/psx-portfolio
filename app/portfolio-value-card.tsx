'use client';

import { ChartInfo } from './chart-info';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EChart } from './charts/echart';
import {
  compact as compactNum,
  timeSeriesOption,
  type TipRow,
} from '@/lib/chart-kit';
import { money, moneyShort, type Portfolio } from '@/lib/portfolio';
import { TabLoader } from './tab-loader';
import {
  portfolioValueSeries,
  sliceValueRange,
  type PricePoint,
  type ValuePoint,
  type ValueRange,
} from '@/lib/price-history';
import { readJson } from '@/lib/safe-json';

const RANGES: [ValueRange, string][] = [
  ['1m', '1M'],
  ['1y', '1Y'],
  ['all', 'All'],
];
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${moneyShort(Math.abs(n))}`;

const dateLabel = (date: string, withYear: boolean) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: withYear ? '2-digit' : undefined,
    timeZone: 'UTC',
  });
const pktToday = () =>
  new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export default function PortfolioValueCard({
  p,
  value,
  cost,
  gain,
  heldCount,
  missingCount,
  unknownCount,
  newBuys,
  aside,
  chartOnly,
  shortAside,
}: {
  p: Portfolio;
  value: number;
  cost: number | null;
  gain: number | null;
  heldCount: number;
  missingCount: number;
  unknownCount: number;
  newBuys: number;
  /** Sits beside the chart (30%) on wide screens; the page renders it elsewhere otherwise. */
  aside?: ReactNode;
  /** Hide the headline numbers; the page already shows them (All portfolios dashboard). */
  chartOnly?: boolean;
  /** The aside holds only the index (no list), so the chart is kept short to match it. */
  shortAside?: boolean;
}) {
  const [range, setRange] = useState<ValueRange>('all');
  const [attempt, setAttempt] = useState(0);
  const tickerKey = useMemo(
    () =>
      Array.from(
        new Set(p.trades.filter((t) => !t.voided).map((t) => t.ticker)),
      )
        .sort()
        .join(','),
    [p.trades],
  );
  // Results are keyed by the request that produced them, so new inputs (or a retry)
  // never show the previous ledger's history or error while the next load runs.
  const requestKey = `${tickerKey}#${attempt}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    eod?: Record<string, PricePoint[]>;
    error?: string;
  } | null>(null);
  const current = loaded?.key === requestKey ? loaded : null;
  const eod = current?.eod ?? null;
  const error = current?.error ?? '';
  useEffect(() => {
    if (!tickerKey) return;
    let live = true;
    fetch(`/api/price-history?tickers=${encodeURIComponent(tickerKey)}`)
      .then(async (r) => {
        const d = (await readJson(r)) as {
          histories?: Record<string, { eod: number[][] }>;
          error?: string;
        };
        if (!r.ok || !d.histories)
          throw Error(d.error ?? 'Could not load price history.');
        if (live)
          setLoaded({
            key: requestKey,
            eod: Object.fromEntries(
              Object.entries(d.histories).map(([t, h]) => [
                t,
                h.eod
                  .filter(
                    (r) =>
                      Number.isFinite(r[0]) &&
                      Number.isFinite(r[1]) &&
                      r[1] > 0,
                  )
                  .map((r): PricePoint => [r[0], r[1]])
                  .sort((a, b) => a[0] - b[0]),
              ]),
            ),
          });
      })
      .catch((e: unknown) => {
        if (live)
          setLoaded({
            key: requestKey,
            error:
              e instanceof Error ? e.message : 'Could not load price history.',
          });
      });
    return () => {
      live = false;
    };
  }, [tickerKey, requestKey]);

  const series = useMemo(
    () =>
      eod
        ? portfolioValueSeries(
            p,
            eod,
            missingCount ? undefined : { date: pktToday(), value, cost, gain },
          )
        : null,
    [p, eod, value, cost, gain, missingCount],
  );
  const points = series ? sliceValueRange(series.points, range) : [];
  const data = points.filter(
    (x): x is ValuePoint & { gain: number; cost: number } =>
      x.gain !== null && x.cost !== null,
  );
  const change =
    data.length > 1 ? data[data.length - 1].gain - data[0].gain : null;
  const rangeLabel =
    range === 'all' ? 'all time' : RANGES.find(([v]) => v === range)![1];

  return (
    <section
      className={
        chartOnly
          ? `value-card value-card--chart-only${aside ? ' value-card--with-aside' : ''}${aside && shortAside ? ' value-card--short-aside' : ''}`
          : 'panel slab value-card'
      }
    >
      <div className="value-card-body">
        <div className="value-card-left">
          {!chartOnly && (
            <div className="value-card-top">
              <div>
                <span className="value-card-label">
                  {missingCount
                    ? 'Priced holdings · incomplete'
                    : 'Portfolio market value'}
                </span>
                <strong className="amount value-card-main">
                  {heldCount > 0 && missingCount === heldCount
                    ? 'Prices needed'
                    : moneyShort(value)}
                </strong>
                <small>
                  {heldCount === 0
                    ? 'No holdings yet'
                    : missingCount
                      ? `${missingCount} holdings need a price`
                      : `${heldCount} holdings · each quote dated below`}
                </small>
              </div>
              <div>
                <span className="value-card-label">Total remaining cost</span>
                <strong className="amount value-card-stat">
                  {moneyShort(cost)}
                </strong>
                <small>
                  {unknownCount
                    ? `${unknownCount} holdings have unknown opening costs`
                    : `New purchases recorded: ${moneyShort(newBuys)}`}
                </small>
              </div>
              <div>
                <span className="value-card-label">Unrealised gain / loss</span>
                <strong
                  className={`amount value-card-stat${gain === null ? '' : gain >= 0 ? ' pos-text' : ' neg-text'}`}
                >
                  {gain === null ? 'Not yet known' : moneyShort(gain)}
                </strong>
                <small>
                  {gain === null
                    ? 'Requires all opening costs and prices'
                    : 'Market value less remaining cost, including buy fees'}
                </small>
              </div>
            </div>
          )}
          <div className="value-card-chart">
            <div className="company-chart-head">
              <div>
                <strong className="value-card-chart-title">
                  Stocks: remaining unrealised gain / loss
                  <ChartInfo text="Value of the shares you still hold minus what they cost you, day by day. PSX stocks only." />
                </strong>
                <small
                  className={
                    change === null
                      ? undefined
                      : change >= 0
                        ? 'pos-text'
                        : 'neg-text'
                  }
                >
                  {change === null
                    ? 'PSX stocks only: value of shares still held minus their remaining cost, day by day. Excludes mutual funds, gold, silver and savings plans, realised gains and dividends.'
                    : `${signed(Math.round(change * 100) / 100)} over ${rangeLabel}`}
                </small>
              </div>
              <div className="seg" aria-label="Chart range">
                {RANGES.map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    data-active={range === v || undefined}
                    onClick={() => setRange(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {!tickerKey ? (
              <p className="muted">
                No transactions yet. Record a purchase to start this chart.
              </p>
            ) : error ? (
              <p className="muted">
                History unavailable: {error}{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  Retry
                </button>
              </p>
            ) : !series ? (
              <TabLoader label="Loading history…" />
            ) : data.length < 2 ? (
              <p className="muted">
                {points.length > 1
                  ? 'Incomplete: gain / loss history needs every opening cost to be known.'
                  : 'Not enough price history yet — the scheduled PSX history job fills it in.'}
              </p>
            ) : (
              <EChart
                className="company-chart"
                label={`Unrealised gain or loss over ${rangeLabel}, ${data.length} days. Latest ${signed(data[data.length - 1].gain)}.`}
                build={(t) =>
                  timeSeriesOption(t, {
                    name: 'Gain / loss',
                    zoom: false,
                    data: data.map((d) => ({ x: d.date, y: d.gain })),
                    area: true,
                    split: true,
                    includeZero: true,
                    refLines: [{ y: 0 }],
                    valueFormat: signed,
                    axisFormat: (v) => compactNum(v),
                    dateLabel: (x, long) => dateLabel(String(x), long),
                    rows: (i): TipRow[] => {
                      const d = data[i];
                      return [
                        ...(d.cost > 0
                          ? [
                              {
                                label: 'Return',
                                value: `${d.gain >= 0 ? '+' : '−'}${Math.abs((d.gain / d.cost) * 100).toFixed(1)}%`,
                                tone: (d.gain >= 0 ? 'pos' : 'neg') as
                                  | 'pos'
                                  | 'neg',
                              },
                            ]
                          : []),
                        {
                          label: 'Invested',
                          value: money(d.cost),
                          tone: 'muted',
                        },
                        {
                          label: 'Value',
                          value: money(d.value),
                          tone: 'muted',
                        },
                      ];
                    },
                  })
                }
              />
            )}
            {series && series.inconsistent.length > 0 && (
              <p className="report-source neg-text">
                Ledger inconsistent: a recorded sale exceeds the shares held for{' '}
                {series.inconsistent.join(', ')}. Those positions are shown as
                zero; correct the ledger.
              </p>
            )}
            {series && series.unpriced.length > 0 && (
              <p className="report-source">
                Not in the chart (no price history yet):{' '}
                {series.unpriced.join(', ')}
              </p>
            )}
          </div>
        </div>
        {aside && <div className="value-card-aside">{aside}</div>}
      </div>
    </section>
  );
}
