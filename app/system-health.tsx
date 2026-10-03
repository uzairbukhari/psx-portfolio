'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DataHealthResponse } from '@/lib/api-types';

const ago = (iso: string | null, now: string) => {
  if (!iso) return 'never';
  const minutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 120) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

/** Super-admin view of GET /api/admin/health: data freshness and recent scrape failures. */
export default function SystemHealth() {
  const [health, setHealth] = useState<DataHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/health', { cache: 'no-store' });
      const body = (await res.json()) as DataHealthResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load system health.');
      setHealth(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load system health.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (error) return <p role="alert" className="notice error">{error}</p>;
  if (!health) return <p className="muted">Loading…</p>;

  const rows: [string, string][] = [
    ['Market', health.marketOpen ? 'Open' : 'Closed'],
    ['Newest quote fetched', `${ago(health.lastQuoteFetchedAt, health.now)}${health.quoteLagMinutes !== null ? ` (${health.quoteLagMinutes} min)` : ''}`],
    ['Newest company facts', ago(health.lastFactsFetchedAt, health.now)],
    ['Unsettled company-data requests', String(health.unsettledFactsRequests)],
  ];

  return (
    <div className="system-health">
      {health.warnings.length === 0 ? (
        <p className="notice">No warnings.</p>
      ) : (
        <ul className="notice error" role="alert">
          {health.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <dl>
        {rows.map(([label, value]) => (
          <div className="set-row" key={label}>
            <dt className="set-row-text"><strong>{label}</strong></dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {health.recentFactsErrors.length > 0 && (
        <>
          <h4>Recent company-data failures</h4>
          <ul>
            {health.recentFactsErrors.map((e) => (
              <li key={e.ticker}>{e.ticker}: {e.error} <span className="muted">({ago(e.attemptedAt, health.now)})</span></li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="secondary compact" disabled={loading} onClick={() => void load()}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
