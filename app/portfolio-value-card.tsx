'use client';

import { useEffect, useMemo, useState } from 'react';
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
  ['3m', '3M'],
  ['6m', '6M'],
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
  missingCount,
}: {
  p: Portfolio;
  value: number;
  cost: number | null;
  gain: number | null;
  missingCount: number;
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
  // Closes older than the first trade are never drawn: ask only for the span the ledger covers (plus a margin).
  const fromKey = useMemo(() => {
    const first = p.trades.filter((t) => !t.voided).map((t) => t.date).sort()[0];
    if (!first || !/^\d{4}-\d{2}-\d{2}$/.test(first)) return '';
    return new Date(Date.parse(`${first}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  }, [p.trades]);
  // Results are keyed by the request that produced them, so new inputs (or a retry)
  // never show the previous ledger's history or error while the next load runs.
  const requestKey = `${tickerKey}@${fromKey}#${attempt}`;
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
    fetch(`/api/price-history?tickers=${encodeURIComponent(tickerKey)}${fromKey ? `&from=${fromKey}` : ''}`)
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
  }, [tickerKey, fromKey, requestKey]);

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
  const data = points;
  const last = data[data.length - 1];
  const loss = last !== undefined && last.cost !== null && last.value < last.cost;
  const rangeLabel =
    range === 'all' ? 'all time' : RANGES.find(([v]) => v === range)![1];

  return (
    <div className="value-chart">
      <div className="value-chart-head">
        <div className="legend">
          <span>
            <i className={`swatch${loss ? ' loss' : ''}`} />
            Value
          </span>
          <span>
            <i className="swatch dash" />
            Invested
          </span>
        </div>
        <div className="sw-seg" role="group" aria-label="Chart range">
          {RANGES.map(([v, label]) => (
            <button
              key={v}
              type="button"
              data-slot="seg"
              aria-pressed={range === v}
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
            ? 'Not enough price history yet.'
            : 'Not enough price history yet. The scheduled PSX history job fills it in.'}
        </p>
      ) : (
        <EChart
          className="value-chart-canvas"
          label={`PSX stocks value against what you invested over ${rangeLabel}, ${data.length} days. Latest value ${money(data[data.length - 1].value)}.`}
          build={(t) =>
            timeSeriesOption(t, {
              name: 'Value',
              zoom: false,
              data: data.map((d) => ({ x: d.date, y: d.value })),
              color: loss ? t.danger : t.success,
              area: true,
              extra: [
                {
                  name: 'Invested',
                  data: data.map((d) => d.cost),
                  color: t.muted,
                  dashed: true,
                  step: true,
                },
              ],
              valueFormat: (n) => money(Math.round(n)),
              axisFormat: (v) => compactNum(v),
              dateLabel: (x, long) => dateLabel(String(x), long),
              rows: (i): TipRow[] => {
                const d = data[i];
                return [
                  ...(d.cost !== null
                    ? [{ label: 'Invested', value: money(d.cost), tone: 'muted' as const }]
                    : []),
                  ...(d.gain !== null
                    ? [
                        {
                          label: 'Gain',
                          value: signed(Math.round(d.gain * 100) / 100),
                          tone: (d.gain >= 0 ? 'pos' : 'neg') as 'pos' | 'neg',
                        },
                      ]
                    : []),
                ];
              },
            })
          }
        />
      )}
      {series && series.inconsistent.length > 0 && (
        <p className="report-source neg-text">
          Ledger inconsistent: a recorded sale exceeds the shares held for{' '}
          {series.inconsistent.join(', ')}. Those positions are shown as zero;
          correct the ledger.
        </p>
      )}
      {series && series.unpriced.length > 0 && (
        <p className="report-source">
          Not in the chart (no price history yet): {series.unpriced.join(', ')}
        </p>
      )}
      <p className="value-chart-note">
        PSX stocks only. Excludes mutual funds, gold, silver and savings plans,
        and dividends.
      </p>
    </div>
  );
}
