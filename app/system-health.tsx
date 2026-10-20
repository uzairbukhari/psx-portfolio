'use client';

import { useState } from 'react';
import type { AdminHealth, PipelineRow } from '@/lib/admin-health';
import type { JobRun } from '@/lib/job-runs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { readJson } from '@/lib/safe-json';
import { Refresher, StatusPill } from './admin-status';
import { ago, title, usd } from './admin-format';
import { useAdminData } from './use-admin-data';

/** Super-admin Health page (GET /api/admin/health): pipelines, queued requests, AI spend, recent failures. */
export default function SystemHealth() {
  const { data: health, error, loading, updatedAt, reload } = useAdminData<AdminHealth>('/api/admin/health');
  const [funds, setFunds] = useState<{ busy: boolean; message?: string; failed?: boolean }>({ busy: false });
  const [note, setNote] = useState<{ text: string; failed: boolean } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; request: Record<string, string> } | null>(null);
  const [history, setHistory] = useState<{ job: string; runs: JobRun[] | null } | null>(null);

  const act = async (request: Record<string, string>) => {
    try {
      const res = await fetch('/api/admin/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
      const body = (await readJson(res)) as { ok?: boolean; message?: string; error?: string };
      setNote({ text: body.message ?? body.error ?? 'Done.', failed: !res.ok });
      void reload();
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : 'The action did not complete.', failed: true });
    }
  };
  const showHistory = async (job: string) => {
    if (history?.job === job) { setHistory(null); return; }
    setHistory({ job, runs: null });
    try {
      const res = await fetch(`/api/admin/runs?job=${encodeURIComponent(job)}`, { cache: 'no-store' });
      const body = (await readJson(res)) as { runs?: JobRun[] };
      setHistory({ job, runs: body.runs ?? [] });
    } catch { setHistory({ job, runs: [] }); }
  };

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
  const action = (p: PipelineRow) => (
    <span className="admin-row-actions">
      {p.action === 'refresh-funds' && <button type="button" className="secondary compact" disabled={funds.busy} onClick={() => void refreshFunds()}>{funds.busy ? 'Fetching…' : 'Refresh now'}</button>}
      {p.workflow && <button type="button" className="secondary compact" onClick={() => setConfirm({ title: `Run ${p.label} now?`, body: `This starts ${p.workflow} on GitHub right away, outside its normal schedule. It only reads public data.`, request: { action: 'run-workflow', workflow: p.workflow! } })}>Run now</button>}
      <button type="button" className="secondary compact" aria-expanded={history?.job === p.id} onClick={() => void showHistory(p.id)}>History</button>
    </span>
  );

  return (
    <div className="system-health admin-health">
      <Refresher updatedAt={updatedAt} loading={loading} onRefresh={() => void reload()} />
      {health.warnings.length === 0 ? <p className="notice">No warnings. The market is {health.marketOpen ? 'open' : 'closed'}.</p> : (
        <ul className="notice error" role="alert">{health.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      <p className="muted admin-cron">Cron Worker heartbeat: <StatusPill status={health.cron.status} /> {health.cron.lastBeatAt ? `last fired ${ago(health.cron.lastBeatAt, nowMs)}` : 'no heartbeat recorded yet'}</p>
      {note && <p role={note.failed ? 'alert' : 'status'} className={note.failed ? 'notice error' : 'notice'}>{note.text}</p>}
      {funds.message && <p role={funds.failed ? 'alert' : 'status'} className={funds.failed ? 'notice error' : 'notice'}>{funds.message}</p>}

      <h2 id="pipelines">Pipelines</h2>
      <div className="pipe-grid">
        {health.pipelines.map((p) => (
          <article key={p.id} className="pipe-card" data-status={p.status}>
            <header>
              <h3>{p.label}</h3>
              <StatusPill status={p.status} />
            </header>
            <dl>
              <div><dt>Last success</dt><dd className="num">{ago(p.lastSuccessAt, nowMs)}</dd></div>
              <div><dt>Last run</dt><dd className="num">{p.lastRun ? <>{ago(p.lastRun.at, nowMs)} <span className="muted">{p.lastRun.ok ? 'ok' : 'failed'}</span></> : <span className="muted">none yet</span>}</dd></div>
            </dl>
            <p className="muted pipe-expected">{p.expected}</p>
            {p.lastError && <p className="admin-error pipe-error">{p.lastError}</p>}
            <footer>{action(p)}</footer>
          </article>
        ))}
      </div>

      {history && (
        <div className="admin-history">
          <h3>Recent runs: {health.pipelines.find((p) => p.id === history.job)?.label}</h3>
          {history.runs === null ? <p className="muted">Loading…</p> : history.runs.length === 0 ? <p className="muted">No runs recorded yet. Runs appear here once the scrapers have run after this release.</p> : (
            <div className="table-wrap">
              <table className="admin-table">
                <thead><tr><th>Finished</th><th>Result</th><th>Source</th><th>Detail</th></tr></thead>
                <tbody>{history.runs.map((r) => <tr key={r.id}><td>{ago(r.finishedAt, nowMs)}</td><td><StatusPill status={r.ok ? 'ok' : 'failing'} label={r.ok ? 'Succeeded' : 'Failed'} /></td><td>{title(r.source)}</td><td className="admin-error">{r.detail ?? ''}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
          <p className="admin-row-actions">
            <button type="button" className="secondary compact" onClick={() => setConfirm({ title: 'Queue stuck requests again?', body: `All ${health.queues.stuckCount} requests waiting over 15 minutes go back to queued so the next scraper run picks them up.`, request: { action: 'retry-stuck' } })}>Retry all</button>
            <button type="button" className="secondary compact" onClick={() => setConfirm({ title: 'Cancel stuck requests?', body: `All ${health.queues.stuckCount} requests waiting over 15 minutes are marked failed. Users see them as failed and can ask again.`, request: { action: 'cancel-stuck' } })}>Cancel all</button>
          </p>
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
      <h3>Face-value finder</h3>
      <div className="admin-spend">
        <div className="admin-kpi"><small>Spent this month</small><strong>{usd(health.aiSpend.faceValue.usd)}</strong><span className="muted">{usd(health.aiSpend.faceValue.allTimeUsd)} all time</span></div>
        <div className="admin-kpi"><small>Lookups this month</small><strong>{health.aiSpend.faceValue.lookups}</strong><span className="muted">{health.aiSpend.faceValue.runs} runs, {health.aiSpend.faceValue.found} values found</span></div>
        <div className="admin-kpi"><small>Cost per lookup</small><strong>{health.aiSpend.faceValue.avgUsd === null ? '–' : usd(health.aiSpend.faceValue.avgUsd)}</strong><span className="muted">spent ÷ lookups</span></div>
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
      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const c = confirm; setConfirm(null); if (c) void act(c.request); }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
