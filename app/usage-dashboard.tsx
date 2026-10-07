'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { UsageReport } from '@/lib/analytics-store';
import { readJson } from '@/lib/safe-json';

const activeConfig = { users: { label: 'Active users', color: 'var(--primary)' } } satisfies ChartConfig;
const signupConfig = { n: { label: 'Sign-ups', color: 'var(--primary)' } } satisfies ChartConfig;
const label = (name: string) => { const t = name.replaceAll('_', ' '); return t[0].toUpperCase() + t.slice(1); };
const pct = (n: number) => `${Math.round(n * 100)}%`;
const shortDay = (d: string) => d.slice(5);

/** Super-admin usage analytics (GET /api/admin/usage): sign-ups, active users, feature use, funnel, retention. */
export default function UsageDashboard() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [includeAdmin, setIncludeAdmin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usage${includeAdmin ? '?admin=1' : ''}`, { cache: 'no-store' });
      const body = (await readJson(res)) as UsageReport & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load usage.');
      setReport(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load usage.');
    } finally {
      setLoading(false);
    }
  }, [includeAdmin]);
  useEffect(() => { void load(); }, [load]);

  if (error) return <p className="muted" role="alert">{error}</p>;
  if (!report) return <p className="muted">Loading…</p>;
  const { active } = report;
  const maxUsers = Math.max(1, ...report.features.map((f) => f.users));
  const top = report.funnel[0]?.users || 0;

  return (
    <div className="system-health usage-dashboard">
      <div className="stat-tiles usage-tiles">
        {([
          ['Total users', report.totalUsers],
          ['New sign-ups, 7 days', report.signups7],
          ['New sign-ups, 30 days', report.signups30],
          ['Active today', active.dau],
          ['Active, 7 days', active.wau],
          ['Active, 30 days', active.mau],
        ] as const).map(([name, value]) => (
          <div key={name} className="stat-tile"><small>{name}</small><strong>{value.toLocaleString()}</strong></div>
        ))}
      </div>
      <p className="muted">
        Stickiness (today ÷ 30 days): {active.stickiness === null ? 'n/a' : pct(active.stickiness)}. Sign-ups count accounts first seen
        since usage tracking began; accounts that already existed are in Total users only.
      </p>

      <h3>Active users per day</h3>
      <ChartContainer config={activeConfig} className="usage-chart">
        <LineChart data={report.dailyActive} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={24} />
          <YAxis width={28} allowDecimals={false} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line dataKey="users" stroke="var(--color-users)" strokeWidth={2} dot={false} />
        </LineChart>
      </ChartContainer>

      <h3>New sign-ups per day</h3>
      {report.signupSeries.length ? (
        <ChartContainer config={signupConfig} className="usage-chart">
          <BarChart data={report.signupSeries} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={24} />
            <YAxis width={28} allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="n" fill="var(--color-n)" radius={3} />
          </BarChart>
        </ChartContainer>
      ) : <p className="muted">No new sign-ups in the last 30 days.</p>}

      <h3>Sign-up funnel (last 30 days)</h3>
      <table className="usage-table">
        <thead><tr><th>Step</th><th>People</th><th>Of first step</th></tr></thead>
        <tbody>
          {report.funnel.map((s) => (
            <tr key={s.step}><td>{s.step}</td><td>{s.users}</td><td>{top ? pct(s.users / top) : '–'}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted">The first two steps count anonymous browsers (this device only); the rest count signed-in accounts.</p>

      <h3>Most used features (last 30 days)</h3>
      {report.features.length ? (
        <table className="usage-table">
          <thead><tr><th>Feature</th><th>Users</th><th>Times</th><th>Web</th><th>Phone</th></tr></thead>
          <tbody>
            {report.features.map((f) => (
              <tr key={f.event}>
                <td>{label(f.event)}<span className="usage-bar" style={{ width: `${(f.users / maxUsers) * 100}%` }} aria-hidden="true" /></td>
                <td>{f.users}</td><td>{f.count}</td><td>{f.web}</td><td>{f.phone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">No feature use recorded yet.</p>}

      <h3>Screens viewed (last 30 days)</h3>
      {report.screens.length ? (
        <table className="usage-table">
          <thead><tr><th>Screen</th><th>Users</th><th>Views</th></tr></thead>
          <tbody>{report.screens.map((s) => <tr key={s.screen}><td>{label(s.screen)}</td><td>{s.users}</td><td>{s.n}</td></tr>)}</tbody>
        </table>
      ) : <p className="muted">No screen views recorded yet.</p>}

      <h3>Weekly retention</h3>
      {report.retention.length ? (
        <div className="usage-scroll">
          <table className="usage-table">
            <thead><tr><th>Sign-up week</th><th>Users</th>{report.retention[0].retained.map((_, i) => <th key={i}>{i === 0 ? 'Wk 0' : `+${i}`}</th>)}</tr></thead>
            <tbody>
              {report.retention.map((c) => (
                <tr key={c.week}>
                  <td>{c.week}</td><td>{c.size}</td>
                  {c.retained.map((r, i) => <td key={i}>{r === null ? '' : pct(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">Retention appears after the first sign-ups.</p>}

      {report.errors.length > 0 && (
        <>
          <h3>Failures (last 30 days)</h3>
          <table className="usage-table">
            <thead><tr><th>Event</th><th>Users</th><th>Times</th></tr></thead>
            <tbody>{report.errors.map((e) => <tr key={e.event}><td>{label(e.event)}</td><td>{e.users}</td><td>{e.count}</td></tr>)}</tbody>
          </table>
        </>
      )}

      <label className="usage-toggle">
        <input type="checkbox" checked={includeAdmin} onChange={(e) => setIncludeAdmin(e.target.checked)} /> Include my own activity
      </label>
      <button type="button" className="secondary compact" disabled={loading} onClick={() => void load()}>
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
