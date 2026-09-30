'use client';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type {
  IndexPoint,
  IndexSummary,
  MarketState,
  ShortlistPerformance,
} from '@/lib/psx-market';
import type { PypsxLiveQuote } from '@/lib/pypsx-market';
import { TabLoader } from './tab-loader';
import { TickerLink } from './ticker-link';

export interface PsxMarketPulseHandle {
  refresh: () => Promise<void>;
}

interface MarketSummary {
  index: IndexSummary | null;
  series: IndexPoint[];
  companies: ShortlistPerformance[];
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
  onOpenShortlist: () => void;
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

export default forwardRef<PsxMarketPulseHandle, Props>(function PsxMarketPulse(
  { onOpenShortlist },
  ref,
) {
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveReceivedAt, setLiveReceivedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(true);
  const liveActive = useRef(false);

  const request = useCallback(async (refresh = false, force = false) => {
    const res = await fetch(`/api/market-summary${force ? '?force=1' : ''}`, {
      method: refresh ? 'POST' : 'GET',
    });
    const body = (await res.json()) as {
      summary?: MarketSummary;
      fetchedAt?: string | null;
      error?: string;
    };
    if (!res.ok || !body.summary) throw Error(body.error || 'Market update failed.');
    setSummary(body.summary);
    setFetchedAt(body.fetchedAt ?? null);
    setError('');
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void request().catch(() => {}), 0);
    const timer = window.setInterval(() => {
      if (!document.hidden && !liveActive.current) void request(true).catch((reason) => setError(reason instanceof Error ? reason.message : 'Market update failed.'));
    }, 60_000);
    const visible = () => {
      if (!document.hidden) void request(true).catch((reason) => setError(reason instanceof Error ? reason.message : 'Market update failed.'));
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [request]);

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
    const connect = () => {
      if (document.hidden || source) return;
      source = new EventSource('/api/market-stream');
      source.addEventListener('status', (event) => {
        const status = JSON.parse((event as MessageEvent<string>).data) as { connected?: boolean };
        liveActive.current = status.connected === true;
        setLiveConnected(liveActive.current);
      });
      source.addEventListener('quote', (event) => {
        const update = JSON.parse((event as MessageEvent<string>).data) as PypsxLiveQuote;
        liveActive.current = true;
        setLiveConnected(true);
        setLiveReceivedAt(update.receivedAt);
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
                retrievedAt: update.receivedAt,
              };
            }),
          };
        });
      });
      source.onerror = () => {
        liveActive.current = false;
        setLiveConnected(false);
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
    <section className="pulse">
      <div className="pulse-head">
        <div>
          <p className="eyebrow">
            <span className={`pulse-dot${summary?.market.isOpen ? '' : ' pulse-dot--closed'}`} aria-hidden="true" />
            MARKET PULSE
          </p>
          {summary && (
            <span className="pulse-source">
              {summary.market.label}{summary.market.estimated ? ' (estimated)' : ''} · {liveConnected ? 'Live via pyPSX' : intradayAvailable ? 'pyPSX intraday · live when open' : `${summary.source.delayMinutes}-minute delayed PSX data`}
            </span>
          )}
        </div>
        <div className="row">
          {displayedAt && (
            <span className={`pulse-stale${stale ? ' pulse-stale--warning' : ''}`}>
              {stale ? 'Cached' : 'Retrieved'} {sourceTime(displayedAt)}
            </span>
          )}
          <button className="secondary compact" disabled={loading} onClick={refresh}>
            <RefreshCw className={loading ? 'spin' : ''} size={14} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="notice error pulse-error">{error}</p>}
      <div className="pulse-grid pulse-grid--shortlist">
        <div className="pulse-index">
          <span className="muted pulse-label">KSE100 Index</span>
          {index ? (
            <>
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
              <small className="pulse-index-source">PSX index time: {index.asOf || 'Unavailable'}</small>
            </>
          ) : (
            <p className="pulse-empty">KSE100 data is unavailable.</p>
          )}
        </div>
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
      </div>
    </section>
  );
});
