'use client';

import { useState } from 'react';
import type { AdminHealth, PipelineRow } from '@/lib/admin-health';
import { readJson } from '@/lib/safe-json';
import { Refresher, StatusPill } from './admin-status';
import { ago, title, usd } from './admin-format';
import { useAdminData } from './use-admin-data';

/** Super-admin Health page (GET /api/admin/health): pipelines, queued requests, AI spend, recent failures. */
export default function SystemHealth() {
  const { data: health, error, loading, updatedAt, reload } = useAdminData<AdminHealth>('/api/admin/health');
  const [funds, setFunds] = useState<{ busy: boolean; message?: string; failed?: boolean }>({ busy: false });

  const refreshFunds = async () => {
    setFunds({ busy: true });
    try {
      const res = await fetch('/api/admin/refresh-funds', { method: 'POST' });
      const body = (await readJson(res)) as { error?: string; funds?: { funds: number; tracked: number; prices: number; newest: string } };
      if (!res.ok || !body.funds) throw new Error(body.error ?? 'Could not refresh fund prices.');
      const f = body.funds;
      setFunds({ busy: false, message: `${f.funds} funds read, ${f.prices} prices stored for ${f.tracked} held funds. MUFAP's newest price date: ${f.newest || 'none'}.` });
      void reload();
    } catch (e) {
      setFunds({ busy: false, failed: true, message: e instanceof Error ? e.message : 'Could not refresh fund prices.' });
    }
  };

  if (error && !health) return <p role="alert" className="notice error">{error}</p>;
  if (!health) return <p className="muted">Loading…</p>;
  const nowMs = Date.parse(health.now);
  const action = (p: PipelineRow) => p.action === 'refresh-funds'
    ? <button type="button" className="secondary compact" disabled={funds.busy} onClick={() => void refreshFunds()}>{funds.busy ? 'Fetching…' : 'Refresh now'}</button>
    : null;

  return (
    <div className="system-health admin-health">
      <Refresher updatedAt={updatedAt} loading={loading} onRefresh={() => void reload()} />
      {health.warnings.length === 0 ? <p className="notice">No warnings. The market is {health.marketOpen ? 'open' : 'closed'}.</p> : (
        <ul className="notice error" role="alert">{health.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {funds.message && <p role={funds.failed ? 'alert' : 'status'} className={funds.failed ? 'notice error' : 'notice'}>{funds.message}</p>}

      <h2 id="pipelines">Pipelines</h2>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>Status</th><th>Pipeline</th><th>Last success</th><th>Expected</th><th>Last error</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {health.pipelines.map((p) => (
              <tr key={p.id}>
                <td><StatusPill status={p.status} /></td>
                <td>{p.label}</td>
                <td>{ago(p.lastSuccessAt, nowMs)}</td>
                <td className="muted">{p.expected}</td>
                <td className="admin-error">{p.lastError ?? ''}</td>
                <td>{action(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="queues">Queued requests</h2>
      {health.queues.counts.length === 0 ? <p className="muted">No data requests have been made yet.</p> : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>Kind</th><th>Status</th><th>Count</th></tr></thead>
            <tbody>{health.queues.counts.map((c) => <tr key={`${c.kind}${c.status}`}><td>{title(c.kind)}</td><td>{title(c.status)}</td><td>{c.n}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {health.queues.stuckCount > 0 && (
        <>
          <h3>Waiting over 15 minutes ({health.queues.stuckCount})</h3>
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>Kind</th><th>Ticker</th><th>Status</th><th>Requested</th><th>Attempts</th><th>Error</th></tr></thead>
              <tbody>
                {health.queues.stuck.map((q) => (
                  <tr key={`${q.kind}${q.ticker}`}><td>{title(q.kind)}</td><td>{q.ticker}</td><td>{title(q.status)}</td><td>{ago(q.requestedAt, nowMs)}</td><td>{q.attempts}</td><td className="admin-error">{q.error ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {health.queues.aiQueued > 0 && <p className="muted">{health.queues.aiQueued} AI research request(s) are waiting for the weekly run.</p>}
      {health.recentFactsErrors.length > 0 && (
        <>
          <h3>Recent company-data failures</h3>
          <ul>{health.recentFactsErrors.map((e) => <li key={e.ticker}>{e.ticker}: {e.error} <span className="muted">({ago(e.attemptedAt, nowMs)})</span></li>)}</ul>
        </>
      )}

      <h2 id="ai-spend">AI spend, {health.aiSpend.month}</h2>
      <div className="admin-spend">
        {health.aiSpend.sources.map((s) => (
          <div key={s.id} className="admin-kpi">
            <small>{s.label}</small><strong>{usd(s.usd)}</strong>
            {s.capUsd ? (<><span className="muted">of {usd(s.capUsd)} monthly cap</span><div className="admin-meter" data-level={s.usd >= s.capUsd * 0.9 ? 'high' : s.usd >= s.capUsd * 0.7 ? 'mid' : 'low'}><span style={{ width: `${Math.min(100, (s.usd / s.capUsd) * 100)}%` }} /></div></>) : <span className="muted">No cap set</span>}
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table className="admin-table">
          <thead><tr><th>Month</th>{health.aiSpend.months.map((m) => <th key={m.month}>{m.month}</th>)}</tr></thead>
          <tbody><tr><td>Total</td>{health.aiSpend.months.map((m) => <td key={m.month}>{usd(m.usd)}</td>)}</tr></tbody>
        </table>
      </div>
      {health.aiSpend.recentRuns.length > 0 && (
        <>
          <h3>Recent AI research runs</h3>
          <div className="table-wrap">
            <table className="admin-table">
              <thead><tr><th>Started</th><th>Status</th><th>Models</th><th>Cost</th><th>Error</th></tr></thead>
              <tbody>
                {health.aiSpend.recentRuns.map((r) => (
                  <tr key={r.startedAt}><td>{ago(r.startedAt, nowMs)}</td><td>{title(r.status)}</td><td>{r.models}</td><td>{usd(r.costUsd)}</td><td className="admin-error">{r.error ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
