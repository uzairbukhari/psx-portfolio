'use client';

import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from '@/components/ui/chart';
import { pct, pkr, pkrCompact, signedPkr } from '@/lib/format';
import type { Portfolio } from '@/lib/portfolio';
import { GainText } from './gain-text';
import { usePortfolioContext } from './portfolio-context';
import { TabLoader } from './tab-loader';
import {
  portfolioValueSeries,
  sliceValueRange,
  type PricePoint,
  type ValuePoint,
  type ValueRange,
} from '@/lib/price-history';

const RANGES: [ValueRange, string][] = [
  ['1m', '1M'],
  ['1y', '1Y'],
  ['all', 'All'],
];
const config = { gain: { label: 'Gain / loss', color: 'var(--primary)' } } satisfies ChartConfig;
const signed = signedPkr;
const compact = (v: number) => {
  const a = Math.abs(v);
  const t = a >= 1e5 ? pkrCompact(a).replace('PKR ', '') : `${Math.round(a / 1000)}k`;
  return v < 0 ? `−${t}` : t;
};

const dateLabel = (date: string, withYear: boolean) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: withYear ? '2-digit' : undefined,
    timeZone: 'UTC',
  });
const pktToday = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

/** Top-of-Overview summary: value, remaining cost and clearly labelled unrealised gain/loss. */
export function PortfolioMetrics({
  value,
  cost,
  gain,
  heldCount,
  missingCount,
  unknownCount,
  newBuys,
}: {
  value: number;
  cost: number | null;
  gain: number | null;
  heldCount: number;
  missingCount: number;
  unknownCount: number;
  newBuys: number;
}) {
  const gainPercent = gain !== null && cost ? (gain / cost) * 100 : null;
  return (
    <section className="panel value-card" aria-label="Portfolio summary">
      <div className="value-card-top">
        <div>
          <span className="value-card-label">
            {missingCount ? 'Priced holdings · incomplete' : 'Portfolio market value'}
          </span>
          <strong className="amount value-card-main">
            {heldCount > 0 && missingCount === heldCount ? 'Prices needed' : pkr(value)}
          </strong>
          <small>
            {heldCount === 0
              ? 'No holdings yet'
              : missingCount
                ? `${missingCount} ${missingCount === 1 ? 'holding needs' : 'holdings need'} a price, so this total is incomplete`
                : `${heldCount} ${heldCount === 1 ? 'holding' : 'holdings'} · each quote dated below`}
          </small>
        </div>
        <div>
          <span className="value-card-label">Total remaining cost</span>
          <strong className="amount value-card-stat">{cost === null ? 'Unknown' : pkr(cost)}</strong>
          <small>
            {unknownCount
              ? `${unknownCount} ${unknownCount === 1 ? 'holding has' : 'holdings have'} an unknown opening cost`
              : `New purchases recorded: ${pkr(newBuys)}`}
          </small>
        </div>
        <div>
          <span className="value-card-label">Unrealised gain / loss</span>
          <strong className="amount value-card-stat">
            <GainText value={gain} percent={gainPercent} unknownLabel="Not yet known" />
          </strong>
          <small>
            {gain === null
              ? 'Requires every opening cost and price'
              : 'Market value less remaining cost, including buy fees. Excludes realised gains and dividends.'}
          </small>
        </div>
      </div>
    </section>
  );
}

/** Day-by-day remaining unrealised gain/loss chart. */
export default function PortfolioHistory({
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
  const { openDialog, busy } = usePortfolioContext();
  const [range, setRange] = useState<ValueRange>('all');
  const [attempt, setAttempt] = useState(0);
  const tickerKey = useMemo(
    () => Array.from(new Set(p.trades.filter((t) => !t.voided).map((t) => t.ticker))).sort().join(','),
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
        const d = (await r.json()) as {
          histories?: Record<string, { eod: number[][] }>;
          error?: string;
        };
        if (!r.ok || !d.histories) throw Error(d.error ?? 'Could not load price history.');
        if (live)
          setLoaded({
            key: requestKey,
            eod: Object.fromEntries(
              Object.entries(d.histories).map(([t, h]) => [
                t,
                h.eod
                  .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0)
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
            error: e instanceof Error ? e.message : 'Could not load price history.',
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
    (x): x is ValuePoint & { gain: number; cost: number } => x.gain !== null && x.cost !== null,
  );
  const gains = data.map((x) => x.gain);
  const lo = gains.length ? Math.min(...gains) : 0;
  const hi = gains.length ? Math.max(...gains) : 0;
  const pad = (Math.max(hi, 0) - Math.min(lo, 0)) * 0.1 || 1;
  // Where zero sits along the line (stroke) and along the filled area (which also spans the 0 baseline).
  const at = (top: number, bottom: number) =>
    top <= 0 ? 0 : bottom >= 0 ? 1 : top / (top - bottom);
  const strokeSplit = at(hi, lo);
  const fillSplit = at(Math.max(hi, 0), Math.min(lo, 0));
  const change = data.length > 1 ? data[data.length - 1].gain - data[0].gain : null;
  const rangeLabel = range === 'all' ? 'all time' : RANGES.find(([v]) => v === range)![1];

  return (
    <section className="panel value-card" aria-label="Gain and loss history">
      <div className="company-chart-head">
        <div>
          <strong className="value-card-chart-title">Remaining unrealised gain / loss</strong>
          <small className={change === null ? undefined : change >= 0 ? 'pos-text' : 'neg-text'}>
            {change === null
              ? 'Value of shares still held minus their remaining cost, day by day. Not total return: excludes realised gains and dividends.'
              : `${signed(Math.round(change * 100) / 100)} over ${rangeLabel}`}
          </small>
        </div>
        <fieldset className="seg">
          <legend className="sr-only">Chart range</legend>
          {RANGES.map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={range === v}
              data-active={range === v || undefined}
              onClick={() => setRange(v)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>
      {!tickerKey ? (
        <div className="empty-inline">
          <p className="muted">No transactions yet, so there is nothing to chart.</p>
          <button type="button" disabled={busy} onClick={() => openDialog({ type: 'trade', kind: 'buy' })}>
            Add first purchase
          </button>
        </div>
      ) : error ? (
        <p className="muted">
          History unavailable: {error}{' '}
          <button type="button" className="link-button" onClick={() => setAttempt((n) => n + 1)}>
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
        <>
        <p className="chart-summary">
          {`Remaining gain / loss moved from ${signed(data[0].gain)} on ${dateLabel(data[0].date, true)} to ${signed(data[data.length - 1].gain)} on ${dateLabel(data[data.length - 1].date, true)}; lowest ${signed(lo)}, highest ${signed(hi)}.`}
        </p>
        <ChartContainer config={config} className="company-chart">
          <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="gainStroke" x1="0" y1="0" x2="0" y2="1">
                <stop offset={strokeSplit} stopColor="var(--success)" />
                <stop offset={strokeSplit} stopColor="var(--danger)" />
              </linearGradient>
              <linearGradient id="gainFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--success)" stopOpacity={0.4} />
                <stop offset={fillSplit} stopColor="var(--success)" stopOpacity={0.04} />
                <stop offset={fillSplit} stopColor="var(--danger)" stopOpacity={0.04} />
                <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.4} />
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
              domain={[Math.min(lo, 0) - pad, Math.max(hi, 0) + pad]}
              width={64}
              tickLine={false}
              axisLine={false}
              tickFormatter={compact}
            />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
            <ChartTooltip
              content={({ active, payload }) => {
                const d = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!d) return null;
                return (
                  <div className="border-border/50 bg-background grid min-w-40 gap-1 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                    <span className="font-medium">{dateLabel(d.date, true)}</span>
                    <span className={d.gain >= 0 ? 'pos-text' : 'neg-text'}>
                      {signed(d.gain)}
                      {d.cost > 0 ? ` (${pct((d.gain / d.cost) * 100, { sign: true })})` : ''}
                    </span>
                    <span className="muted">Invested {pkr(d.cost)}</span>
                    <span className="muted">Value {pkr(d.value)}</span>
                  </div>
                );
              }}
            />
            <Area
              dataKey="gain"
              type="monotone"
              stroke="url(#gainStroke)"
              strokeWidth={2}
              fill="url(#gainFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
        </>
      )}
      {series && series.inconsistent.length > 0 && (
        <p className="report-source neg-text">
          Ledger inconsistent: a recorded sale exceeds the shares held for{' '}
          {series.inconsistent.join(', ')}. Those positions are shown as zero; correct the ledger.
        </p>
      )}
      {series && series.unpriced.length > 0 && (
        <p className="report-source">
          Not in the chart (no price history yet): {series.unpriced.join(', ')}
        </p>
      )}
    </section>
  );
}
