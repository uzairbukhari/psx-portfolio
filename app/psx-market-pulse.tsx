'use client';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { IndexSummary, TopMovers, IndexPoint } from '@/lib/psx-market';

export interface PsxMarketPulseHandle {
  refresh: () => Promise<void>;
}

interface SectorRow {
  sector: string;
  changePercent: number;
  companyCount: number;
}

interface MarketSummary {
  index: IndexSummary;
  movers: TopMovers;
  series: IndexPoint[];
  sectors: SectorRow[];
}

function Sparkline({ points, up }: { points: IndexPoint[]; up: boolean }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 300;
  const height = 56;
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p.value - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      className="pulse-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
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

function timeAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default forwardRef<PsxMarketPulseHandle>(function PsxMarketPulse(_props, ref) {
  const [summary, setSummary] = useState<MarketSummary | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await fetch('/api/market-summary');
      const body = (await res.json()) as { summary: MarketSummary | null; fetchedAt?: string };
      if (body.summary) {
        setSummary(body.summary);
        setFetchedAt(body.fetchedAt ?? null);
      }
    } catch {
      // Silently keep whatever was last shown — this widget is a supplement, not core data.
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/market-summary', { method: 'POST' });
      const body = (await res.json()) as { summary?: MarketSummary; error?: string };
      if (!res.ok || !body.summary) throw Error(body.error || 'Refresh failed.');
      setSummary(body.summary);
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed.');
    } finally {
      setLoading(false);
    }
  }

  useImperativeHandle(ref, () => ({ refresh }));

  if (!summary) {
    return (
      <section className="pulse">
        <div className="pulse-head">
          <p className="eyebrow">
            <span className="pulse-dot" aria-hidden="true" /> MARKET PULSE
          </p>
          <button className="secondary compact" disabled={loading} onClick={refresh}>
            <RefreshCw size={14} /> {loading ? 'Loading…' : 'Load market data'}
          </button>
        </div>
        <p className="pulse-empty">
          {error || 'No cached PSX market data yet — load it to see the KSE100 index, top movers and sector performance.'}
        </p>
      </section>
    );
  }

  const { index, movers, series, sectors } = summary;
  const indexUp = index.change >= 0;
  const topSectors = [...sectors].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent)).slice(0, 6);

  return (
    <section className="pulse">
      <div className="pulse-head">
        <p className="eyebrow">
          <span className="pulse-dot" aria-hidden="true" /> MARKET PULSE
        </p>
        <div className="row">
          {fetchedAt && <span className="pulse-stale">Updated {timeAgo(fetchedAt)}</span>}
          <button className="secondary compact" disabled={loading} onClick={refresh}>
            <RefreshCw size={14} /> {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice error" style={{ marginTop: 0 }}>
          {error}
        </p>
      )}
      <div className="pulse-grid">
        <div>
          <span className="muted" style={{ fontSize: 13 }}>
            KSE100 Index
          </span>
          <div className="pulse-index__value">{index.close.toLocaleString()}</div>
          <span className={`pulse-index__change ${indexUp ? 'pos' : 'neg'}`}>
            {indexUp ? '▲' : '▼'} {Math.abs(index.change).toLocaleString()} ({index.changePercent.toFixed(2)}%)
          </span>
          <Sparkline points={series} up={indexUp} />
          <div className="pulse-stats">
            <div>
              High
              <b>{index.high.toLocaleString()}</b>
            </div>
            <div>
              Low
              <b>{index.low.toLocaleString()}</b>
            </div>
            <div>
              YTD
              <b>{index.ytdChangePercent.toFixed(2)}%</b>
            </div>
          </div>
        </div>
        <div className="pulse-movers">
          <h4>Top Advancers</h4>
          <div className="pulse-mover-list">
            {movers.advancers.slice(0, 4).map((m) => (
              <div className="pulse-mover-row" key={m.symbol}>
                <span>{m.symbol}</span>
                <b className="pos">+{m.changePercent.toFixed(2)}%</b>
              </div>
            ))}
          </div>
          <h4 style={{ marginTop: 16 }}>Top Decliners</h4>
          <div className="pulse-mover-list">
            {movers.decliners.slice(0, 4).map((m) => (
              <div className="pulse-mover-row" key={m.symbol}>
                <span>{m.symbol}</span>
                <b className="neg">{m.changePercent.toFixed(2)}%</b>
              </div>
            ))}
          </div>
        </div>
        <div className="pulse-sectors">
          <h4>Sector performance</h4>
          {topSectors.length ? (
            topSectors.map((s) => (
              <div className="pulse-sector-row" key={s.sector}>
                <div>
                  {s.sector}
                  <div className="pulse-sector-bar">
                    <i
                      className={s.changePercent >= 0 ? 'pos' : 'neg'}
                      style={{ width: `${Math.min(50, Math.abs(s.changePercent) * 8)}%` }}
                    />
                  </div>
                </div>
                <b className={s.changePercent >= 0 ? 'pos' : 'neg'}>{s.changePercent.toFixed(1)}%</b>
              </div>
            ))
          ) : (
            <p className="pulse-empty">Sector data refreshes twice daily — check back after the next cycle.</p>
          )}
        </div>
      </div>
    </section>
  );
});
