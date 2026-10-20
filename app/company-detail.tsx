'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TabLoader } from './tab-loader';
import { EChart } from './charts/echart';
import { barOption, timeSeriesOption } from '@/lib/chart-kit';
import {
  money,
  type Dividend,
  type Portfolio,
  type StockSplit,
  type TaxedDividend,
  type Trade,
} from '@/lib/portfolio';
import {
  rangeChange,
  sliceRange,
  type HistoryRange,
  type PricePoint,
} from '@/lib/price-history';
import LedgerTimeline from './ledger-timeline';
import { cachedHoldings } from './portfolio-memo';
import { buildEntries } from '@/lib/ledger-entries';
import { readJson } from '@/lib/safe-json';
import { useMarketGlance } from './use-market-glance';
import { TickerTile } from './ui-kit';
import CompanyKeyStats from './company-key-stats';

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
  ['today', '1D'],
  ['7d', '1W'],
  ['1m', '1M'],
  ['3m', '3M'],
  ['6m', '6M'],
  ['1y', '1Y'],
  ['5y', '5Y'],
];

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
        year:
          range === '1y' || range === '3y' || range === '5y'
            ? '2-digit'
            : undefined,
        timeZone: 'Asia/Karachi',
      });
}

function PriceChart({
  ticker,
  holding,
  trades,
  onHistory,
}: {
  ticker: string;
  holding: Holding | undefined;
  trades: Trade[];
  onHistory?: (history: History | null) => void;
}) {
  const [range, setRange] = useState<HistoryRange>('1y');
  const [attempt, setAttempt] = useState(0);
  // Keyed by request, so switching company (or retrying) never shows the previous
  // company's history or error while the next load runs.
  const requestKey = `${ticker}#${attempt}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    history?: History;
    error?: string;
  } | null>(null);
  const current = loaded?.key === requestKey ? loaded : null;
  const history = current?.history ?? null;
  const error = current?.error ?? '';
  useEffect(() => {
    let live = true;
    fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}`)
      .then(async (r) => {
        const d = (await readJson(r)) as History & { error?: string };
        if (!r.ok) throw Error(d.error ?? 'Could not load price history.');
        if (live) {
          setLoaded({
            key: requestKey,
            history: { eod: d.eod, intraday: d.intraday },
          });
          onHistory?.({ eod: d.eod, intraday: d.intraday });
        }
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
  }, [ticker, requestKey, onHistory]);

  const points = useMemo(
    () => (history ? sliceRange(history.eod, history.intraday, range) : []),
    [history, range],
  );
  const change = rangeChange(points);
  const up = (change?.change ?? 0) >= 0;
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
    <section className="card company-price-card">
      <div className="company-chart-head">
        <div>
          <span className="lbl">Price</span>
          {change && (
            <div className="company-chart-delta">
              <span className={`pill ${up ? 'g' : 'l'}`}>
                {up ? '+' : '−'}Rs{' '}
                {Math.abs(Math.round(change.change * 100) / 100).toFixed(2)} ·{' '}
                {Math.abs(change.percent).toFixed(1)}%
              </span>
              <small>over {RANGES.find(([v]) => v === range)![1]}</small>
            </div>
          )}
        </div>
        <div className="sw-seg" role="group" aria-label="Chart range">
          {RANGES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-slot="seg"
              aria-pressed={range === value}
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
          <button
            type="button"
            className="link-button"
            onClick={() => setAttempt((n) => n + 1)}
          >
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
        <EChart
          className="company-chart"
          label={`${ticker} price, ${RANGES.find(([v]) => v === range)![1]}. ${points.length} points, latest ${money(points[points.length - 1][1])}.`}
          build={(t) =>
            timeSeriesOption(t, {
              name: 'Price',
              data: points.map(([sec, price]) => ({
                x: sec * 1000,
                y: price,
              })),
              area: true,
              color: t.primary,
              valueFormat: (n) => money(n),
              axisFormat: (v) => v.toFixed(0),
              dateLabel: (x) => tickLabel(Number(x) / 1000, range),
              refLines:
                holding?.average != null &&
                holding.average >= lo - pad &&
                holding.average <= hi + pad
                  ? [{ y: holding.average, label: 'Avg. cost' }]
                  : undefined,
              markers: markers.map(({ t: tr, x }) => ({
                x: x * 1000,
                y: tr.price!,
                color: tr.kind === 'sell' ? t.danger : t.success,
                label: `${tr.kind === 'sell' ? 'Sold' : 'Bought'} ${tr.shares} at ${money(tr.price!)} · ${tr.date}`,
              })),
            })
          }
        />
      )}
      <div className="company-legend">
        <span>
          <i className="swatch" /> Close
        </span>
        {holding?.average != null && (
          <span>
            <i className="swatch dash" /> Your average cost
          </span>
        )}
        <span>
          <i className="dot buy" /> Your buys
        </span>
        <span>
          <i className="dot sell" /> Your sales
        </span>
        <span className="hint">Scroll to zoom · drag to pan</span>
      </div>
    </section>
  );
}

/** History depth when the app loaded; anything above it was pushed by in-app navigation. */
const ENTRY_HISTORY_LENGTH =
  typeof window === 'undefined' ? 0 : window.history.length;

export default function CompanyDetail({
  portfolio,
  ticker,
  holding,
  summary,
  taxed,
  busy,
  onBack,
  onAddPurchase,
  onSell,
  onDividend,
  onSplit,
  onEdit,
  onChangeTicker,
  onCorrectTrade,
  onCorrectDividend,
  onCorrectSplit,
  onConfirmDividend,
}: {
  portfolio: Portfolio;
  ticker: string;
  holding: Holding | undefined;
  summary: Summary;
  taxed: TaxedDividend[];
  busy: boolean;
  onBack: () => void;
  onAddPurchase: () => void;
  onSell: () => void;
  onDividend: () => void;
  onSplit: () => void;
  onEdit: () => void;
  onChangeTicker: () => void;
  onCorrectTrade: (t: Trade) => void;
  onCorrectDividend: (d: Dividend) => void;
  onCorrectSplit: (s: StockSplit) => void;
  onConfirmDividend: (d: Dividend) => void;
}) {
  const trades = portfolio.trades.filter((t) => t.ticker === ticker);
  const dividends = (portfolio.dividends ?? []).filter(
    (d) => d.ticker === ticker,
  );
  const splits = (portfolio.stockSplits ?? []).filter(
    (s) => s.ticker === ticker,
  );
  const entries = buildEntries({
    trades,
    dividends,
    splits,
    taxed,
    onCorrectTrade,
    onCorrectDividend,
    onCorrectSplit,
    onConfirmDividend,
  });
  const byId = new Map(taxed.map((t) => [t.id, t]));
  const expectedDividends = dividends
    .filter((d) => !d.voided && byId.get(d.id)?.status === 'expected')
    .sort((a, b) => a.date.localeCompare(b.date));
  const received = dividends
    .filter((d) => !d.voided && byId.get(d.id)?.status !== 'expected')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      const t = byId.get(d.id);
      return {
        d,
        gross: t?.grossAmount ?? 0,
        net: t?.netAmount ?? t?.grossAmount ?? 0,
      };
    });
  const cumulative = received.map((r, i) => ({
    date: r.d.date,
    net: Math.round(r.net * 100) / 100,
    total:
      Math.round(
        received.slice(0, i + 1).reduce((a, x) => a + x.net, 0) * 100,
      ) / 100,
  }));
  const known = holding !== undefined;
  // Only step back through history the app itself added; a direct link falls back to Holdings.
  const goBack = () => {
    if (window.history.length > ENTRY_HISTORY_LENGTH) window.history.back();
    else onBack();
  };
  const held = (holding?.shares ?? 0) > 0;
  const stocksValue = cachedHoldings(portfolio).reduce(
    (a, h) => a + (h.value ?? 0),
    0,
  );
  const weight =
    summary.value !== null && stocksValue > 0
      ? summary.value / stocksValue
      : null;

  const glance = useMarketGlance(
    [ticker],
    Object.fromEntries(portfolio.companies.map((c) => [c.ticker, c.name])),
    portfolio.quotes,
  );
  const todayRow = glance.companies.find((c) => c.ticker === ticker);
  const [history, setHistory] = useState<{
    ticker: string;
    data: History | null;
  } | null>(null);
  const onHistory = useCallback(
    (data: History | null) => setHistory({ ticker, data }),
    [ticker],
  );
  const priceHistory = history?.ticker === ticker ? history.data : null;
  const [lowerTab, setLowerTab] = useState<'activity' | 'dividends'>(
    'activity',
  );
  const dividendTotal =
    summary.dividendNet === null ? summary.dividendGross : summary.dividendNet;
  const expectedTotal = expectedDividends.reduce(
    (sum, d) =>
      sum + (byId.get(d.id)?.netAmount ?? byId.get(d.id)?.grossAmount ?? 0),
    0,
  );

  return (
    <div className="company-page">
      <button
        type="button"
        data-slot="link"
        className="back-link company-back"
        onClick={goBack}
      >
        <ArrowLeft size={15} /> Holdings
        {holding?.sector && (
          <>
            <span className="sep">/</span>
            {holding.sector}
          </>
        )}
      </button>
      <div className="company-head">
        <div className="company-id">
          <TickerTile ticker={ticker} size={56} />
          <div>
            <h1>{holding?.name ?? ticker}</h1>
            <p className="company-sub">
              <b className="num">{ticker}</b>
              {holding?.sector && (
                <span className="pill">{holding.sector}</span>
              )}
              {!holding && <span>Not in your companies list</span>}
            </p>
          </div>
        </div>
        <div className="company-price">
          {holding?.quote ? (
            <strong className="num">
              <span className="rs">Rs</span> {holding.quote.price.toFixed(2)}
            </strong>
          ) : (
            <strong className="num">—</strong>
          )}
          <div className="company-price-meta">
            {todayRow?.changePercent !== null &&
              todayRow?.changePercent !== undefined && (
                <span
                  className={`pill ${todayRow.changePercent >= 0 ? 'g' : 'l'}`}
                >
                  {todayRow.changePercent >= 0 ? '▲' : '▼'}{' '}
                  {Math.abs(todayRow.change ?? 0).toFixed(2)} ·{' '}
                  {Math.abs(todayRow.changePercent).toFixed(2)}%
                </span>
              )}
            <small>
              {holding?.quote
                ? `Latest quote · ${holding.quote.date}${holding.quote.manual ? ' · manual' : ''}`
                : 'No quote yet'}
            </small>
          </div>
        </div>
        <div className="company-actions">
          <button disabled={busy} onClick={onAddPurchase}>
            <Plus size={16} /> Record trade
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="secondary company-more"
              aria-label="More actions"
            >
              <MoreHorizontal size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {held && (
                <DropdownMenuItem disabled={busy} onClick={onSell}>
                  Sell
                </DropdownMenuItem>
              )}
              {held && (
                <DropdownMenuItem disabled={busy} onClick={onDividend}>
                  Dividend
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={busy} onClick={onSplit}>
                Bonus / split
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy || !known} onClick={onEdit}>
                Edit company
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy || !known}
                onClick={onChangeTicker}
              >
                Change symbol
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="company-grid">
        <PriceChart
          key={ticker}
          ticker={ticker}
          holding={holding}
          trades={trades}
          onHistory={onHistory}
        />
        <CompanyKeyStats
          ticker={ticker}
          day={
            todayRow || holding?.quote
              ? {
                  high: todayRow?.high ?? null,
                  low: todayRow?.low ?? null,
                  volume: todayRow?.volume ?? null,
                  previousClose: todayRow?.previousClose ?? null,
                  price: todayRow?.price ?? holding?.quote?.price ?? null,
                }
              : undefined
          }
          eod={priceHistory?.eod ?? []}
          intraday={priceHistory?.intraday ?? []}
        />
        <section className="card company-dividends-card">
          <div className="between">
            <span className="lbl">Dividends</span>
            <b className="num pos-text">+{money(dividendTotal)}</b>
          </div>
          {received.length > 0 && (
            <EChart
              className="company-div-chart"
              label={`Dividends received, ${received.length} payments.`}
              build={(t) =>
                barOption(t, {
                  cats: received.map(({ d }) => d.date.slice(0, 7)),
                  series: [
                    {
                      name: 'Received',
                      data: received.map(({ net }) => net),
                      color: t.success,
                    },
                  ],
                  valueFormat: (n) => money(n),
                })
              }
            />
          )}
          <small className="position-note">
            {summary.dividendNet === null
              ? 'Gross · set filer status for net'
              : 'Net of tax'}
          </small>
          {expectedDividends.length > 0 && (
            <div className="expected-note">
              <div>
                <b>{money(Math.round(expectedTotal))} expected</b>
                <small>Book closure {expectedDividends[0].date}</small>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onConfirmDividend(expectedDividends[0])}
              >
                Mark received
              </button>
            </div>
          )}
        </section>
        <section className="card company-position">
          <span className="lbl">Your position</span>
          <div className="position-tiles">
            <div>
              <span>Shares</span>
              <b className="num">{(holding?.shares ?? 0).toLocaleString()}</b>
            </div>
            <div>
              <span>Avg cost</span>
              <b className="num">
                {holding?.average == null ? '—' : money(holding.average)}
              </b>
            </div>
            <div>
              <span>Value</span>
              <b className="num">
                {summary.value === null ? '—' : money(summary.value)}
              </b>
            </div>
            <div>
              <span>Unrealised</span>
              <b className={`num ${tone(summary.gain) ?? ''}`}>
                {summary.gain === null ? '—' : money(summary.gain)}
              </b>
              {summary.gainPercent !== null && (
                <small className={tone(summary.gainPercent)}>
                  {pct(summary.gainPercent)}
                </small>
              )}
            </div>
          </div>
          {summary.gain === null && (
            <p className="position-note">
              Needs cost and price for profit / loss.
            </p>
          )}
          {weight !== null && (
            <div className="position-weight">
              <div className="between">
                <span>Weight in stocks</span>
                <b className="num">{(weight * 100).toFixed(1)}%</b>
              </div>
              <div className="bar-track" aria-hidden="true">
                <i style={{ width: `${Math.min(100, weight * 100)}%` }} />
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="card company-lower">
        <div className="sw-seg" role="tablist" aria-label="Company details">
          {(
            [
              ['activity', 'Activity'],
              ['dividends', 'Dividends'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              data-slot="seg"
              aria-selected={lowerTab === key}
              aria-pressed={lowerTab === key}
              onClick={() => setLowerTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {lowerTab === 'activity' && (
          <section className="company-section">
            <h2>Activity</h2>
            {entries.length === 0 ? (
              <p className="muted">
                No transactions recorded for {ticker} yet.
              </p>
            ) : (
              <LedgerTimeline
                portfolio={portfolio}
                entries={entries}
                ticker={ticker}
                hideKpis
              />
            )}
          </section>
        )}

        {lowerTab === 'dividends' && (
          <>
            {expectedDividends.length > 0 && (
              <section className="company-section">
                <h2>Expected dividends</h2>
                <p className="muted">
                  Announced by PSX but not confirmed as paid. They are not
                  counted as income until you mark them received.
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
                        <strong>
                          {money(
                            Math.round(
                              (t?.netAmount ?? t?.grossAmount ?? 0) * 100,
                            ) / 100,
                          )}
                        </strong>
                        <small>
                          {d.perShare === undefined
                            ? ''
                            : `${money(d.perShare)}/sh · `}
                          {money(Math.round((t?.grossAmount ?? 0) * 100) / 100)}{' '}
                          gross · estimated tax · entitled on{' '}
                          {d.entitlementDate ?? 'unknown date'}
                          {d.entitlementCertain === false
                            ? ' (unconfirmed)'
                            : ''}
                        </small>
                        <button
                          type="button"
                          className="secondary compact card-action"
                          onClick={() => onConfirmDividend(d)}
                        >
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
                          {d.perShare === undefined
                            ? ''
                            : `${money(d.perShare)}/sh · `}
                          {money(Math.round(gross * 100) / 100)} gross ·{' '}
                          {d.source === 'import'
                            ? 'CDC import'
                            : d.source === 'auto'
                              ? 'PSX auto'
                              : 'Manual'}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="dividend-charts">
                    <div className="panel">
                      <h3>Per payment</h3>
                      <EChart
                        className="company-chart"
                        label={`Dividends received per payment, ${cumulative.length} payments.`}
                        build={(t) =>
                          barOption(t, {
                            cats: cumulative.map((d) => d.date),
                            series: [
                              {
                                name: 'Received',
                                data: cumulative.map((d) => d.net),
                                color: t.success,
                              },
                            ],
                            valueFormat: (n) => money(n),
                          })
                        }
                      />
                    </div>
                    <div className="panel">
                      <h3>Cumulative</h3>
                      <EChart
                        className="company-chart"
                        label={`Cumulative dividends received, ${cumulative.length} payments.`}
                        build={(t) =>
                          timeSeriesOption(t, {
                            name: 'Cumulative',
                            data: cumulative.map((d) => ({
                              x: d.date,
                              y: d.total,
                            })),
                            categorical: true,
                            step: true,
                            zoom: false,
                            includeZero: true,
                            valueFormat: (n) => money(n),
                            dateLabel: (x) => String(x),
                          })
                        }
                      />
                    </div>
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </section>
    </div>
  );
}
