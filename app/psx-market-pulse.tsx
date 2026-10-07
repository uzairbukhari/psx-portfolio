'use client';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import type {
  IndexPoint,
  IndexSummary,
  MarketState,
  ShortlistPerformance,
} from '@/lib/psx-market';
import type { PypsxLiveQuote } from '@/lib/pypsx-market';
import type { MarketBreadthView, MarketIndexView } from '@/lib/api-types';
import type { Portfolio, Quote } from '@/lib/portfolio';
import { applyLocalWatch, watchQuery } from '@/lib/market-watch';
import { TabLoader } from './tab-loader';
import { TickerLink } from './ticker-link';
import { readJson } from '@/lib/safe-json';

export interface PsxMarketPulseHandle {
  refresh: () => Promise<void>;
}

interface MarketSummary {
  index: IndexSummary | null;
  indices?: MarketIndexView[];
  breadth?: MarketBreadthView | null;
  series: IndexPoint[];
  companies: ShortlistPerformance[];
  /** Cached quotes behind `companies` (public); used to tell whether a saved quote is newer. */
  quotes?: Record<string, Quote>;
  market: MarketState;
  source: {
    name: string;
    url: string;
    delayMinutes: number;
    mode: 'delayed';
  };
  live: { available: boolean; intradayAvailable: boolean; provider: 'pyPSX' };
}

interface Props {
  /** `shortlist`: the Monthly Picks shortlist (All view). `holdings`: the biggest movers among what one portfolio holds. */
  mode?: 'shortlist' | 'holdings';
  onOpenShortlist: () => void;
  /** Refresh everything the page refreshes (PSX prices included), not only the market summary. */
  onRefresh?: () => void | Promise<void>;
  /** The page is busy refreshing prices. */
  refreshing?: boolean;
  /** The companies to follow. Only these tickers are sent to the server; names and saved quotes stay local. */
  tickers: string[];
  names: Record<string, string>;
  saved: Portfolio['quotes'];
}

function Sparkline({ points, up }: { points: IndexPoint[]; up: boolean }) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 300;
  const height = 56;
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * width;
    const y = height - ((point.value - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="pulse-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={up ? 'var(--success)' : 'var(--danger)'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const number = (value: number | null, digits = 2) =>
  value === null
    ? 'Unavailable'
    : value.toLocaleString('en-PK', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

function sourceTime(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('en-PK', { timeZone: 'Asia/Karachi', dateStyle: 'medium', timeStyle: 'short' })
    : value;
}

// The server answer for a watch list is public market data, so the device keeps the last one (not the private
// names/saved quotes the client folds in afterwards) to show instantly and to survive a Worker outage.
const SAVED_KEY = 'sipwise:market-summary:v1';
function loadSummary(tickers: string[]): { summary: MarketSummary; fetchedAt: string | null } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(`${SAVED_KEY}:${tickers.join(',')}`) ?? 'null');
    return saved?.summary?.companies ? saved : null;
  } catch {
    return null;
  }
}
function saveSummary(tickers: string[], summary: MarketSummary, fetchedAt: string | null) {
  try {
    localStorage.setItem(`${SAVED_KEY}:${tickers.join(',')}`, JSON.stringify({ summary, fetchedAt }));
  } catch {}
}

/** Best and worst movers today among the companies a portfolio holds. */
function HoldingsMovers({ companies }: { companies: ShortlistPerformance[] | null }) {
  if (!companies) return <TabLoader label="Loading today's moves in your holdings…" />;
  const moved = companies.filter((c) => c.changePercent !== null && c.price !== null);
  const up = moved.filter((c) => c.changePercent! > 0).sort((a, b) => b.changePercent! - a.changePercent!).slice(0, 4);
  const down = moved.filter((c) => c.changePercent! < 0).sort((a, b) => a.changePercent! - b.changePercent!).slice(0, 4);
  const flat = moved.length - moved.filter((c) => c.changePercent !== 0).length;
  const list = (title: string, rows: ShortlistPerformance[], tone: 'pos' | 'neg') => (
    <div className="pulse-movers">
      <h4>{title}</h4>
      {rows.length ? (
        <div className="pulse-mover-list">
          {rows.map((c) => (
            <div className="pulse-mover-row" key={c.ticker}>
              <span><TickerLink ticker={c.ticker} /></span>
              <b className={tone}>
                {c.changePercent! > 0 ? '+' : ''}
                {number(c.changePercent!)}%
              </b>
            </div>
          ))}
        </div>
      ) : (
        <p className="pulse-empty">None today.</p>
      )}
    </div>
  );
  if (!moved.length)
    return (
      <div className="pulse-shortlist">
        <p className="pulse-empty">Prices for your holdings have not loaded yet.</p>
      </div>
    );
  return (
    <div className="pulse-shortlist pulse-holdings">
      <div className="pulse-shortlist__head">
        <div>
          <h4>Your holdings today</h4>
          <span>
            {moved.filter((c) => c.changePercent! > 0).length} up ·{' '}
            {moved.filter((c) => c.changePercent! < 0).length} down · {flat} unchanged
          </span>
        </div>
      </div>
      <div className="pulse-holdings__cols">
        {list('Top gainers', up, 'pos')}
        {list('Top decliners', down, 'neg')}
      </div>
    </div>
  );
}

export default forwardRef<PsxMarketPulseHandle, Props>(function PsxMarketPulse(
  { mode = 'shortlist', onOpenShortlist, onRefresh, refreshing = false, tickers, names, saved },
  ref,
) {
  const watch = useRef({ tickers, names, saved });
  watch.current = { tickers, names, saved };
  const tickerList = tickers.join(',');
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveReceivedAt, setLiveReceivedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const liveActive = useRef(false);
  // Outside a session the saved closing values are shown and no refresh is requested.
  const sessionOpen = useRef(false);

  // The Worker only does real refresh work on a POST, and the scraper keeps data current every ~10 minutes, so
  // everything else is a cheap conditional GET and a POST is sent at most this often.
  const lastPost = useRef(0);
  const postDue = () => Date.now() - lastPost.current > 10 * 60_000;

  const request = useCallback(async (refresh = false, force = false) => {
    if (refresh) lastPost.current = Date.now();
    const query = [force ? 'force=1' : '', watchQuery(watch.current.tickers)].filter(Boolean).join('&');
    const res = await fetch(`/api/market-summary${query ? `?${query}` : ''}`, {
      method: refresh ? 'POST' : 'GET',
    });
    const body = (await readJson(res)) as {
      summary?: MarketSummary;
      fetchedAt?: string | null;
      error?: string;
    };
    if (!res.ok || !body.summary) throw Error(body.error || 'Market update failed.');
    saveSummary(watch.current.tickers, body.summary, body.fetchedAt ?? null);
    setSummary({
      ...body.summary,
      companies: applyLocalWatch(body.summary.companies, watch.current.names, watch.current.saved, body.summary.quotes),
    });
    sessionOpen.current = body.summary.market.isOpen;
    setFetchedAt(body.fetchedAt ?? null);
    setError('');
  }, []);

  useEffect(() => {
    // Paint the last answer saved on this device straight away; the request below only replaces it with newer data.
    const saved = loadSummary(watch.current.tickers);
    if (saved)
      queueMicrotask(() => {
        setSummary((current) => current ?? {
          ...saved.summary,
          companies: applyLocalWatch(saved.summary.companies, watch.current.names, watch.current.saved, saved.summary.quotes),
        });
        setFetchedAt((current) => current ?? saved.fetchedAt);
      });
    const initial = window.setTimeout(() => void request().catch(() => {}), 0);
    const timer = window.setInterval(() => {
      if (!document.hidden && !liveActive.current && sessionOpen.current) void request(postDue()).catch((reason) => setError(reason instanceof Error ? reason.message : 'Market update failed.'));
    }, 120_000);
    const visible = () => {
      if (!document.hidden) void request(sessionOpen.current && postDue()).catch((reason) => setError(reason instanceof Error ? reason.message : 'Market update failed.'));
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
      document.removeEventListener('visibilitychange', visible);
    };
    // A different watch list needs a fresh answer for exactly those tickers.
  }, [request, tickerList]);

  const liveAvailable = summary?.live.available ?? false;
  const intradayAvailable = summary?.live.intradayAvailable ?? false;
  const marketOpen = summary?.market.isOpen ?? false;
  const tickerKey = summary?.companies.map((company) => company.ticker).join(',') ?? '';
  useEffect(() => {
    if (!liveAvailable || !marketOpen || !tickerKey) {
      liveActive.current = false;
      queueMicrotask(() => setLiveConnected(false));
      return;
    }
    let source: EventSource | null = null;
    // Native EventSource reconnects forever; bound it so a failing feed falls back to delayed polling.
    let failures = 0;
    let retryTimer: number | undefined;
    const connect = () => {
      if (document.hidden || source) return;
      source = new EventSource(`/api/market-stream?${watchQuery(watch.current.tickers)}`);
      source.addEventListener('status', (event) => {
        const status = JSON.parse((event as MessageEvent<string>).data) as { connected?: boolean; reason?: string };
        liveActive.current = status.connected === true;
        setLiveConnected(liveActive.current);
        if (status.connected === true) failures = 0;
        else if (status.reason) {
          // Server closed an idle or long-lived stream: reconnect once, after a pause.
          source?.close();
          source = null;
          retryTimer = window.setTimeout(connect, 5000);
        }
      });
      source.addEventListener('quote', (event) => {
        const update = JSON.parse((event as MessageEvent<string>).data) as PypsxLiveQuote & { timeKnown?: boolean };
        liveActive.current = true;
        setLiveConnected(true);
        // A tick without a provider timestamp updates the price but is not shown as a freshly timed quote.
        if (update.timeKnown !== false) setLiveReceivedAt(update.receivedAt);
        setSummary((current) => {
          if (!current) return current;
          const providerOpen = update.providerMarketState === 'OPN';
          const providerClosed = ['CLS', 'SUS'].includes(update.providerMarketState ?? '');
          return {
            ...current,
            market:
              providerOpen || providerClosed
                ? { ...current.market, isOpen: providerOpen, label: providerOpen ? 'Open' : 'Closed', estimated: false }
                : current.market,
            companies: current.companies.map((company) => {
              if (company.ticker !== update.ticker) return company;
              const change =
                update.change ??
                (company.previousClose === null ? company.change : update.price - company.previousClose);
              const changePercent =
                update.changePercent ??
                (company.previousClose && change !== null
                  ? (change / company.previousClose) * 100
                  : company.changePercent);
              return {
                ...company,
                price: update.price,
                change,
                changePercent,
                high: update.high ?? company.high,
                low: update.low ?? company.low,
                volume: update.volume ?? company.volume,
                sourceTimestamp: update.sourceTimestamp ?? company.sourceTimestamp,
                retrievedAt: update.timeKnown === false ? company.retrievedAt : update.receivedAt,
              };
            }),
          };
        });
      });
      source.onerror = () => {
        liveActive.current = false;
        setLiveConnected(false);
        source?.close();
        source = null;
        failures += 1;
        if (failures <= 3) retryTimer = window.setTimeout(connect, 5000 * 3 ** (failures - 1));
      };
    };
    const visibility = () => {
      if (document.hidden) {
        source?.close();
        source = null;
        liveActive.current = false;
        setLiveConnected(false);
      } else connect();
    };
    connect();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearTimeout(retryTimer);
      source?.close();
      liveActive.current = false;
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [liveAvailable, marketOpen, tickerKey]);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      await request(true, true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Market update failed.');
    } finally {
      setLoading(false);
    }
  }

  useImperativeHandle(ref, () => ({ refresh }));

  const index = summary?.index ?? null;
  const indexUp = (index?.change ?? 0) >= 0;
  const headlineMeta = summary?.indices?.find((entry) => entry.code === 'KSE100')?.meta ?? null;
  const newestQuote = summary?.companies.reduce<string | null>(
    (latest, company) =>
      company.retrievedAt && (!latest || company.retrievedAt > latest)
        ? company.retrievedAt
        : latest,
    null,
  );
  const displayedAt = liveReceivedAt ?? newestQuote ?? fetchedAt;
  useEffect(() => {
    const update = () =>
      setStale(
        !displayedAt ||
          new Date().getTime() - new Date(displayedAt).getTime() > 7 * 60_000,
      );
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [displayedAt]);

  return (
    <section className="pulse" data-expanded={expanded || undefined}>
      <button
        type="button"
        className="pulse-summary secondary"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className={`pulse-dot${summary?.market.isOpen ? '' : ' pulse-dot--closed'}`} aria-hidden="true" />
        <span className="pulse-summary__text">
          {index ? (
            <>
              KSE100 {index.close.toLocaleString()}{' '}
              <b className={indexUp ? 'pos' : 'neg'}>
                {indexUp ? '▲' : '▼'}
                {Math.abs(index.changePercent).toFixed(2)}%
              </b>
            </>
          ) : (
            'Market pulse'
          )}
          {summary ? ` · ${summary.market.label}` : ''}
        </span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      <div className="pulse-head">
        <div>
          <p className="eyebrow">
            <span className={`pulse-dot${summary?.market.isOpen ? '' : ' pulse-dot--closed'}`} aria-hidden="true" />
            MARKET PULSE
          </p>
          {summary && (
            <span className="pulse-source">
              {summary.market.label}{summary.market.estimated ? ' (estimated)' : ''} · {liveConnected ? 'Live' : intradayAvailable ? 'Intraday · live when open' : `Delayed ${summary.source.delayMinutes} min`}
            </span>
          )}
        </div>
        <div className="row">
          {displayedAt && (
            <span className={`pulse-stale${stale ? ' pulse-stale--warning' : ''}`}>
              {stale ? 'Cached' : 'Retrieved'} {sourceTime(displayedAt)}
            </span>
          )}
          <button
            className="secondary compact"
            disabled={loading || refreshing}
            onClick={() => (onRefresh ? void onRefresh() : void refresh())}
          >
            <RefreshCw className={loading || refreshing ? 'spin' : ''} size={14} />
            {loading || refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && !summary && <p className="notice pulse-error">Market data is unavailable right now. It will retry automatically.</p>}
      {summary?.breadth && summary.breadth.covered > 0 && (
        <p className="muted pulse-breadth">
          {summary.breadth.advances.toLocaleString()} up · {summary.breadth.declines.toLocaleString()} down · {summary.breadth.unchanged.toLocaleString()} unchanged
          {' '}across {summary.breadth.covered.toLocaleString()} securities in the {summary.breadth.source}
          {summary.breadth.excluded > 0 ? ` (${summary.breadth.excluded.toLocaleString()} without valid prices left out)` : ''}.
        </p>
      )}
      <div className={`pulse-grid pulse-grid--shortlist${index ? '' : ' pulse-grid--solo'}`}>
        {index && (
          <div className="pulse-index">
            <span className="muted pulse-label">KSE100 Index</span>
            <div className="pulse-index__value">{index.close.toLocaleString()}</div>
            <span className={`pulse-index__change ${indexUp ? 'pos' : 'neg'}`}>
              {indexUp ? '▲' : '▼'} {Math.abs(index.change).toLocaleString()} ({index.changePercent.toFixed(2)}%)
            </span>
            <Sparkline points={summary?.series ?? []} up={indexUp} />
            <div className="pulse-stats">
              <div>High<b>{index.high.toLocaleString()}</b></div>
              <div>Low<b>{index.low.toLocaleString()}</b></div>
              <div>YTD<b>{index.ytdChangePercent.toFixed(2)}%</b></div>
            </div>
            <small className="pulse-index-source">
              PSX index time: {index.asOf || 'Unavailable'}
              {headlineMeta && (
                <span className={`pulse-fresh pulse-fresh--${headlineMeta.freshness}`} title={headlineMeta.reason}>
                  {' · '}{headlineMeta.freshness === 'fresh' ? 'Fresh' : headlineMeta.freshness === 'delayed' ? 'Delayed' : 'Stale'}
                </span>
              )}
            </small>
          </div>
        )}
        {mode === 'holdings' ? (
          <HoldingsMovers companies={summary?.companies ?? null} />
        ) : (
        <div className="pulse-shortlist">
          <div className="pulse-shortlist__head">
            <div>
              <h4>Your shortlisted companies</h4>
              <span>Price · today</span>
            </div>
            <button className="quote-btn" onClick={onOpenShortlist}>Edit shortlist</button>
          </div>
          {summary?.companies.length ? (
            <div className="pulse-company-list">
              {summary.companies.map((company) => {
                const direction = company.change === null ? '' : company.change > 0 ? 'pos' : company.change < 0 ? 'neg' : '';
                const change =
                  company.changePercent === null
                    ? '—'
                    : `${company.changePercent > 0 ? '+' : ''}${number(company.changePercent)}%`;
                const accessibleSummary = `${company.name}, ${company.ticker}. Price ${company.price === null ? 'unavailable' : `Rs ${number(company.price)}`}. Today ${company.changePercent === null ? 'unavailable' : `${number(company.changePercent)} percent`}.`;
                const title = `${company.name}${company.change === null ? '' : ` · ${company.change > 0 ? '+' : ''}${number(company.change)} today`}`;
                return (
                  <article className={`pulse-company ${direction}`} key={company.ticker} title={title} aria-label={accessibleSummary}>
                    <b className="pulse-company__ticker"><TickerLink ticker={company.ticker} /></b>
                    <b className={`pulse-company__change ${direction}`}>{change}</b>
                    <b className="pulse-company__price">
                      {company.price === null ? '—' : <><small>Rs</small> {number(company.price)}</>}
                    </b>
                  </article>
                );
              })}
            </div>
          ) : summary ? (
            <div className="pulse-empty pulse-empty--shortlist">
              <p>Choose companies in Monthly Picks to track their current performance here.</p>
              <button className="secondary compact" onClick={onOpenShortlist}>Open Monthly Picks</button>
            </div>
          ) : (
            <TabLoader label="Loading your shortlist and latest saved market data…" />
          )}
        </div>
        )}
      </div>
    </section>
  );
});
