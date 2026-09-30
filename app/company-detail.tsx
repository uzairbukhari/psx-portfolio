'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { TabLoader } from './tab-loader';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  money,
  type Dividend,
  type TaxedDividend,
  type Trade,
} from '@/lib/portfolio';
import {
  rangeChange,
  sliceRange,
  type HistoryRange,
  type PricePoint,
} from '@/lib/price-history';
import LedgerTimeline, { buildEntries } from './ledger-timeline';
import { usePortfolioContext } from './portfolio-context';

type Holding = {
  ticker: string;
  name: string;
  sector: string;
  shares: number;
  cost: number | null;
  average: number | null;
  value: number | null;
  gain: number | null;
  quote?: { price: number; date: string; manual?: boolean };
};

type Summary = {
  cost: number | null;
  value: number | null;
  gain: number | null;
  gainPercent: number | null;
  dividendGross: number;
  dividendNet: number | null;
};

type History = { eod: PricePoint[]; intraday: PricePoint[] };

const RANGES: [HistoryRange, string][] = [
  ['today', 'Today'],
  ['7d', '7D'],
  ['1m', '1M'],
  ['1y', '1Y'],
];

const priceConfig = { price: { label: 'Price', color: 'var(--primary)' } } satisfies ChartConfig;
const divConfig = {
  net: { label: 'Received', color: 'var(--success)' },
} satisfies ChartConfig;
const cumConfig = {
  total: { label: 'Cumulative', color: 'var(--primary)' },
} satisfies ChartConfig;

const tradeSeconds = (date: string) =>
  Math.round(Date.parse(`${date}T12:00:00+05:00`) / 1000);
const tone = (n: number | null) =>
  n === null ? undefined : n >= 0 ? 'pos-text' : 'neg-text';
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

function tickLabel(seconds: number, range: HistoryRange) {
  const d = new Date(seconds * 1000);
  return range === 'today'
    ? d.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Karachi',
      })
    : d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: range === '1y' ? '2-digit' : undefined,
        timeZone: 'Asia/Karachi',
      });
}

function PriceChart({
  ticker,
  holding,
  trades,
}: {
  ticker: string;
  holding: Holding | undefined;
  trades: Trade[];
}) {
  const [range, setRange] = useState<HistoryRange>('1m');
  const [attempt, setAttempt] = useState(0);
  // Keyed by request, so switching company (or retrying) never shows the previous
  // company's history or error while the next load runs.
  const requestKey = `${ticker}#${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; history?: History; error?: string } | null>(null);
  const current = loaded?.key === requestKey ? loaded : null;
  const history = current?.history ?? null;
  const error = current?.error ?? '';
  useEffect(() => {
    let live = true;
    fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}`)
      .then(async (r) => {
        const d = (await r.json()) as History & { error?: string };
        if (!r.ok) throw Error(d.error ?? 'Could not load price history.');
        if (live) setLoaded({ key: requestKey, history: { eod: d.eod, intraday: d.intraday } });
      })
      .catch((e: unknown) => {
        if (live)
          setLoaded({ key: requestKey, error: e instanceof Error ? e.message : 'Could not load price history.' });
      });
    return () => {
      live = false;
    };
  }, [ticker, requestKey]);

  const points = useMemo(
    () => (history ? sliceRange(history.eod, history.intraday, range) : []),
    [history, range],
  );
  const change = rangeChange(points);
  const up = (change?.change ?? 0) >= 0;
  const color = up ? 'var(--success)' : 'var(--danger)';
  const data = points.map(([t, price]) => ({ t, price }));
  const lo = points.length ? Math.min(...points.map((p) => p[1])) : 0;
  const hi = points.length ? Math.max(...points.map((p) => p[1])) : 0;
  const pad = (hi - lo) * 0.08 || hi * 0.02;
  const first = points[0]?.[0];
  const last = points.at(-1)?.[0];
  const markers =
    range === 'today' || first === undefined || last === undefined
      ? []
      : trades
          .filter((t) => !t.voided && t.price !== null && t.kind !== 'opening')
          .map((t) => ({ t, x: tradeSeconds(t.date) }))
          .filter(({ x }) => x >= first && x <= last);

  return (
    <section className="panel">
      <div className="company-chart-head">
        <div>
          <h3>Performance on PSX</h3>
          {change && (
            <small className={up ? 'pos-text' : 'neg-text'}>
              {up ? '+' : ''}
              {money(Math.round(change.change * 100) / 100)} ({pct(change.percent)}) over{' '}
              {RANGES.find(([v]) => v === range)![1]}
            </small>
          )}
        </div>
        <div className="seg" aria-label="Chart range">
          {RANGES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-active={range === value || undefined}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className="muted">
          Price history unavailable: {error}{' '}
          <button type="button" className="link-button" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </p>
      ) : !history ? (
        <TabLoader label="Loading price history…" />
      ) : points.length < 2 ? (
        <p className="muted">
          {range === 'today'
            ? 'No intraday ticks stored yet — they fill in while the PSX is open.'
            : 'Price history has not been collected for this company yet. The scheduled PSX history job fills it in.'}
        </p>
      ) : (
        <ChartContainer config={priceConfig} className="company-chart">
          <AreaChart data={data} margin={{ top: 10, right: 12, bottom: 4, left: 8 }}>
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
              tickFormatter={(v: number) => tickLabel(v, range)}
            />
            <YAxis
              domain={[lo - pad, hi + pad]}
              width={56}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(_, payload) =>
                    tickLabel(Number(payload?.[0]?.payload?.t ?? 0), range)
                  }
                  formatter={(value) => money(Number(value))}
                />
              }
            />
            {holding?.average != null && holding.average >= lo - pad && holding.average <= hi + pad && (
              <ReferenceLine
                y={holding.average}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                label={{ value: 'Avg. cost', position: 'insideTopLeft', fontSize: 11, fill: 'var(--muted-foreground)' }}
              />
            )}
            <Area
              dataKey="price"
              type="monotone"
              stroke={color}
              strokeWidth={2}
              fill="url(#priceFill)"
              dot={false}
              isAnimationActive={false}
            />
            {markers.map(({ t, x }) => (
              <ReferenceDot
                key={t.id}
                x={x}
                y={t.price!}
                r={5}
                fill={t.kind === 'sell' ? 'var(--danger)' : 'var(--success)'}
                stroke="var(--background)"
                ifOverflow="hidden"
              />
            ))}
          </AreaChart>
        </ChartContainer>
      )}
      {markers.length > 0 && (
        <p className="report-source">
          Green dots: your purchases · red dots: your sales · dashed line: average cost
        </p>
      )}
    </section>
  );
}

export default function CompanyDetail({
  ticker,
  holding,
  summary,
  entries,
  taxed,
  onBack,
}: {
  ticker: string;
  holding: Holding | undefined;
  summary: Summary;
  entries: ReturnType<typeof buildEntries>;
  taxed: TaxedDividend[];
  onBack: () => void;
}) {
  const { p: portfolio, busy, openDialog } = usePortfolioContext();
  const trades = portfolio.trades.filter((t) => t.ticker === ticker);
  const dividends = (portfolio.dividends ?? []).filter((d) => d.ticker === ticker);
  const onConfirmDividend = (d: Dividend) => openDialog({ type: 'receipt', dividend: d });
  const onAddPurchase = () => openDialog({ type: 'trade', ticker, kind: 'buy' });
  const onSell = () => openDialog({ type: 'trade', ticker, kind: 'sell' });
  const onDividend = () => openDialog({ type: 'dividend', ticker });
  const onSplit = () => openDialog({ type: 'split', ticker });
  const onEdit = () => openDialog({ type: 'company', ticker });
  const byId = new Map(taxed.map((t) => [t.id, t]));
  const expectedDividends = dividends
    .filter((d) => !d.voided && byId.get(d.id)?.status === 'expected')
    .sort((a, b) => a.date.localeCompare(b.date));
  const received = dividends
    .filter((d) => !d.voided && byId.get(d.id)?.status !== 'expected')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      const t = byId.get(d.id);
      return { d, gross: t?.grossAmount ?? 0, net: t?.netAmount ?? t?.grossAmount ?? 0 };
    });
  const cumulative = received.map((r, i) => ({
    date: r.d.date,
    net: Math.round(r.net * 100) / 100,
    total:
      Math.round(received.slice(0, i + 1).reduce((a, x) => a + x.net, 0) * 100) / 100,
  }));
  const known = holding !== undefined;

  return (
    <div className="company-page">
      <button type="button" className="secondary compact company-back" onClick={onBack}>
        <ArrowLeft size={15} /> Back to holdings
      </button>
      <div className="company-head">
        <div>
          <p className="eyebrow">
            {holding?.sector ? holding.sector.toUpperCase() : 'COMPANY'}
          </p>
          <h1>{ticker}</h1>
          <p>{holding?.name ?? 'Not in your companies list'}</p>
        </div>
        <div className="company-price">
          <strong>{holding?.quote ? money(holding.quote.price) : '—'}</strong>
          <small>
            {holding?.quote
              ? `Latest quote · ${holding.quote.date}${holding.quote.manual ? ' · manual' : ''}`
              : 'No quote yet'}
          </small>
        </div>
        <div className="row">
          <button className="secondary" disabled={busy || !known} onClick={onEdit}>
            Edit
          </button>
          <button className="secondary" disabled={busy} onClick={onSplit}>
            Record split
          </button>
          {(holding?.shares ?? 0) > 0 && (
            <button className="secondary" disabled={busy} onClick={onSell}>
              Sell
            </button>
          )}
          {(holding?.shares ?? 0) > 0 && (
            <button className="secondary" disabled={busy} onClick={onDividend}>
              Dividend
            </button>
          )}
          <button disabled={busy} onClick={onAddPurchase}>
            <Plus size={16} /> Add purchase
          </button>
        </div>
      </div>

      <div className="company-cards">
        <article>
          <span>Shares held</span>
          <strong>{(holding?.shares ?? 0).toLocaleString()}</strong>
          <small>
            Avg. cost {holding?.average == null ? '—' : money(holding.average)}
          </small>
        </article>
        <article>
          <span>Invested → current</span>
          <strong>{summary.value === null ? '—' : money(summary.value)}</strong>
          <small>Invested {summary.cost === null ? '—' : money(summary.cost)}</small>
        </article>
        <article>
          <span>Profit / loss</span>
          <strong className={tone(summary.gain)}>
            {summary.gain === null ? '—' : money(summary.gain)}
          </strong>
          <small className={tone(summary.gainPercent)}>
            {summary.gainPercent === null ? 'Needs cost and price' : pct(summary.gainPercent)}
          </small>
        </article>
        <article>
          <span>Dividends earned</span>
          <strong>
            {money(summary.dividendNet === null ? summary.dividendGross : summary.dividendNet)}
          </strong>
          <small>
            {summary.dividendNet === null
              ? 'Gross · set filer status in Settings for net'
              : `Net of tax (estimated unless recorded) · ${money(summary.dividendGross)} gross`}
          </small>
        </article>
      </div>

      <PriceChart key={ticker} ticker={ticker} holding={holding} trades={trades} />

      <section className="company-section">
        <h2>Purchase log</h2>
        {entries.length === 0 ? (
          <p className="muted">No transactions recorded for {ticker} yet.</p>
        ) : (
          <LedgerTimeline portfolio={portfolio} entries={entries} ticker={ticker} />
        )}
      </section>

      {expectedDividends.length > 0 && (
        <section className="company-section">
          <h2>Expected dividends</h2>
          <p className="muted">
            Announced by PSX but not confirmed as paid. They are not counted as income until you mark them received.
          </p>
          <div className="dividend-grid">
            {expectedDividends.map((d) => {
              const t = byId.get(d.id);
              return (
                <div className="dividend-card" key={d.id}>
                  <span>
                    Book closure {d.date}
                    {d.financialYear ? ` · FY ${d.financialYear}` : ''}
                  </span>
                  <strong>{money(Math.round((t?.netAmount ?? t?.grossAmount ?? 0) * 100) / 100)}</strong>
                  <small>
                    {d.perShare === undefined ? '' : `${money(d.perShare)}/sh · `}
                    {money(Math.round((t?.grossAmount ?? 0) * 100) / 100)} gross · estimated tax · entitled on{' '}
                    {d.entitlementDate ?? 'unknown date'}
                    {d.entitlementCertain === false ? ' (unconfirmed)' : ''}
                  </small>
                  <button type="button" className="secondary compact card-action" onClick={() => onConfirmDividend(d)}>
                    Mark received
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section className="company-section">
        <h2>Dividends received</h2>
        {received.length === 0 ? (
          <p className="muted">No dividends recorded for {ticker} yet.</p>
        ) : (
          <>
            <div className="dividend-grid">
              {[...received].reverse().map(({ d, gross, net }) => (
                <div className="dividend-card" key={d.id}>
                  <span>
                    {d.date}
                    {d.financialYear ? ` · FY ${d.financialYear}` : ''}
                  </span>
                  <strong>{money(Math.round(net * 100) / 100)}</strong>
                  <small>
                    {d.perShare === undefined ? '' : `${money(d.perShare)}/sh · `}
                    {money(Math.round(gross * 100) / 100)} gross ·{' '}
                    {d.source === 'import' ? 'CDC import' : d.source === 'auto' ? 'PSX auto' : 'Manual'}
                  </small>
                </div>
              ))}
            </div>
            <div className="dividend-charts">
              <div className="panel">
                <h3>Per payment</h3>
                <ChartContainer config={divConfig} className="company-chart">
                  <BarChart data={cumulative} margin={{ top: 10, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis width={56} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
                    <Bar dataKey="net" fill="var(--color-net)" radius={4} />
                  </BarChart>
                </ChartContainer>
              </div>
              <div className="panel">
                <h3>Cumulative</h3>
                <ChartContainer config={cumConfig} className="company-chart">
                  <LineChart data={cumulative} margin={{ top: 10, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis width={56} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent formatter={(v) => money(Number(v))} />} />
                    <Line dataKey="total" type="stepAfter" stroke="var(--color-total)" strokeWidth={2} dot />
                  </LineChart>
                </ChartContainer>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
