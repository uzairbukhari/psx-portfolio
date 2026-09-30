'use client';

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { money, type Portfolio } from '@/lib/portfolio';
import {
  portfolioValueSeries,
  sliceValueRange,
  type PricePoint,
  type ValueRange,
} from '@/lib/price-history';

const RANGES: [ValueRange, string][] = [
  ['1m', '1M'],
  ['1y', '1Y'],
  ['all', 'All'],
];
const config = { value: { label: 'Market value', color: 'var(--primary)' } } satisfies ChartConfig;

const dateLabel = (date: string, withYear: boolean) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: withYear ? '2-digit' : undefined,
    timeZone: 'UTC',
  });
const pktToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

export default function PortfolioValueCard({
  p,
  value,
  cost,
  gain,
  heldCount,
  missingCount,
  unknownCount,
  newBuys,
}: {
  p: Portfolio;
  value: number;
  cost: number | null;
  gain: number | null;
  heldCount: number;
  missingCount: number;
  unknownCount: number;
  newBuys: number;
}) {
  const [range, setRange] = useState<ValueRange>('all');
  const [eod, setEod] = useState<Record<string, PricePoint[]> | null>(null);
  const [error, setError] = useState('');
  const tickerKey = useMemo(
    () => Array.from(new Set(p.trades.filter((t) => !t.voided).map((t) => t.ticker))).sort().join(','),
    [p.trades],
  );
  useEffect(() => {
    if (!tickerKey) return;
    let live = true;
    fetch(`/api/price-history?tickers=${encodeURIComponent(tickerKey)}`)
      .then(async (r) => {
        const d = (await r.json()) as {
          histories?: Record<string, { eod: number[][] }>;
          error?: string;
        };
        if (!r.ok || !d.histories) throw Error(d.error ?? 'Could not load price history.');
        if (live)
          setEod(
            Object.fromEntries(
              Object.entries(d.histories).map(([t, h]) => [
                t,
                h.eod
                  .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0)
                  .map((r): PricePoint => [r[0], r[1]])
                  .sort((a, b) => a[0] - b[0]),
              ]),
            ),
          );
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Could not load price history.');
      });
    return () => {
      live = false;
    };
  }, [tickerKey]);

  const series = useMemo(
    () =>
      eod
        ? portfolioValueSeries(
            p,
            eod,
            missingCount ? undefined : { date: pktToday(), value },
          )
        : null,
    [p, eod, value, missingCount],
  );
  const points = series ? sliceValueRange(series.points, range) : [];
  const first = points[0]?.value;
  const last = points.at(-1)?.value;
  const change = points.length > 1 && first !== undefined && last !== undefined ? last - first : null;
  const up = (change ?? 0) >= 0;
  const color = up ? 'var(--success)' : 'var(--danger)';
  const lo = points.length ? Math.min(...points.map((x) => x.value)) : 0;
  const hi = points.length ? Math.max(...points.map((x) => x.value)) : 0;
  const pad = (hi - lo) * 0.08 || hi * 0.02;

  return (
    <section className="panel value-card">
      <div className="value-card-top">
        <div>
          <span className="value-card-label">
            {missingCount ? 'Priced holdings · incomplete' : 'Portfolio market value'}
          </span>
          <strong className="amount value-card-main">
            {missingCount === heldCount ? 'Prices needed' : money(value)}
          </strong>
          <small>
            {missingCount
              ? `${missingCount} holdings need a price`
              : `${heldCount} holdings · each quote dated below`}
          </small>
        </div>
        <div>
          <span className="value-card-label">Total remaining cost</span>
          <strong className="amount value-card-stat">{money(cost)}</strong>
          <small>
            {unknownCount
              ? `${unknownCount} holdings have unknown opening costs`
              : `New purchases recorded: ${money(newBuys)}`}
          </small>
        </div>
        <div>
          <span className="value-card-label">Unrealised gain / loss</span>
          <strong
            className="amount value-card-stat"
            style={{
              color: gain === null ? 'inherit' : gain >= 0 ? '#22e0a0' : '#ff5d6c',
            }}
          >
            {gain === null ? 'Not yet known' : money(gain)}
          </strong>
          <small>
            {gain === null
              ? 'Requires all opening costs and prices'
              : 'Market value less remaining cost, including buy fees'}
          </small>
        </div>
      </div>
      <div className="company-chart-head">
        <small className={change === null ? undefined : up ? 'pos-text' : 'neg-text'}>
          {change === null
            ? 'Portfolio value over time'
            : `${up ? '+' : ''}${money(Math.round(change * 100) / 100)} over ${
                RANGES.find(([v]) => v === range)![1] === 'All' ? 'all time' : RANGES.find(([v]) => v === range)![1]
              } · market value at each day's close`}
        </small>
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
      {error ? (
        <p className="muted">{error}</p>
      ) : !series ? (
        <p className="muted">Loading value history…</p>
      ) : points.length < 2 ? (
        <p className="muted">
          Not enough price history yet — the scheduled PSX history job fills it in.
        </p>
      ) : (
        <ChartContainer config={config} className="company-chart">
          <AreaChart data={points} margin={{ top: 10, right: 12, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              minTickGap={40}
              tickFormatter={(d: string) => dateLabel(d, range !== '1m')}
            />
            <YAxis
              domain={[lo - pad, hi + pad]}
              width={64}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) =>
                Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1000)}k`
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    dateLabel(String(payload?.[0]?.payload?.date ?? ''), true)
                  }
                  formatter={(v) => money(Number(v))}
                />
              }
            />
            <Area
              dataKey="value"
              type="monotone"
              stroke={color}
              strokeWidth={2}
              fill="url(#valueFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      )}
      {series && series.unpriced.length > 0 && (
        <p className="report-source">
          Not in the chart (no price history yet): {series.unpriced.join(', ')}
        </p>
      )}
    </section>
  );
}
