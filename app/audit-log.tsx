'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { AuditReport, AuditRow } from '@/lib/analytics-store';
import { ERROR_AREAS } from '@/lib/error-codes';
import { readJson } from '@/lib/safe-json';
import type { AdminActionRow } from '@/lib/admin-actions';

const errorConfig = { n: { label: 'Errors', color: 'var(--destructive)' } } satisfies ChartConfig;
const label = (name: string) => { const t = name.replaceAll('_', ' '); return t[0].toUpperCase() + t.slice(1); };

/** Super-admin audit log (GET /api/admin/audit): errors users hit, by category and code. Never shows message text. */
export default function AuditLog({ includeInternal, days: rangeDays }: { includeInternal?: boolean; days?: number } = {}) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [code, setCode] = useState('');
  const [ownDays, setDays] = useState(7);
  const days = rangeDays ?? ownDays;
  const [keyFilter, setKeyFilter] = useState('');
  const [more, setMore] = useState<AuditRow[]>([]);
  const [moreDone, setMoreDone] = useState(false);
  const [paging, setPaging] = useState(false);
  const [user, setUser] = useState('');
  const [ownToggle, setOwnToggle] = useState(false);
  const includeAdmin = includeInternal ?? ownToggle;
  const [actions, setActions] = useState<AdminActionRow[]>([]);
  useEffect(() => {
    void fetch('/api/admin/actions', { cache: 'no-store' }).then((r) => readJson(r)).then((b) => setActions((b as { actions?: AdminActionRow[] }).actions ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ days: String(days) });
    if (area) q.set('area', area);
    if (code) q.set('code', code);
    if (user.trim()) q.set('user', user.trim());
    else if (keyFilter) q.set('key', keyFilter);
    if (includeAdmin) q.set('admin', '1');
    try {
      const res = await fetch(`/api/admin/audit?${q}`, { cache: 'no-store' });
      const body = (await readJson(res)) as AuditReport & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load the audit log.');
      setReport(body);
      setMore([]);
      setMoreDone(!body.hasMore);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audit log.');
    }
  }, [area, code, days, user, keyFilter, includeAdmin]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(t); }, [load]);

  const loadMore = async () => {
    if (!report) return;
    setPaging(true);
    const q = new URLSearchParams({ days: String(days), offset: String(report.rows.length + more.length) });
    if (area) q.set('area', area);
    if (code) q.set('code', code);
    if (user.trim()) q.set('user', user.trim()); else if (keyFilter) q.set('key', keyFilter);
    if (includeAdmin) q.set('admin', '1');
    try {
      const res = await fetch(`/api/admin/audit?${q}`, { cache: 'no-store' });
      const body = (await readJson(res)) as AuditReport & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load more.');
      setMore((m) => [...m, ...body.rows]);
      setMoreDone(!body.hasMore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more.');
    } finally { setPaging(false); }
  };

  if (error) return <p className="muted" role="alert">{error}</p>;
  if (!report) return <p className="muted">Loading…</p>;
  const countOf = (a: string) => report.byArea.find((r) => r.area === a)?.n ?? 0;
  const total = report.byArea.reduce((n, r) => n + r.n, 0);

  return (
    <div className="system-health usage-dashboard">
      <fieldset className="audit-filters">
        <legend className="sr-only">Filters</legend>
        <button type="button" aria-pressed={!area} onClick={() => { setArea(''); setCode(''); }}>All ({total})</button>
        {ERROR_AREAS.map((a) => (
          <button key={a} type="button" aria-pressed={area === a} onClick={() => { setArea(a); setCode(''); }}>{label(a)} ({countOf(a)})</button>
        ))}
        {rangeDays === undefined && (
          <select aria-label="Time range" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 7, 30, 90, 180].map((d) => <option key={d} value={d}>{d === 1 ? 'Today' : `Last ${d} days`}</option>)}
          </select>
        )}
        <select aria-label="Error code" value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">All codes</option>
          {report.byCode.map((c) => <option key={`${c.area}${c.code}`} value={c.code}>{label(c.code)} ({c.n})</option>)}
        </select>
        <input aria-label="Filter by user email" placeholder="User email" value={user} onChange={(e) => setUser(e.target.value)} />
        {includeInternal === undefined && (
          <label><input type="checkbox" checked={ownToggle} onChange={(e) => setOwnToggle(e.target.checked)} /> Include internal accounts</label>
        )}
      </fieldset>
      {keyFilter && !user.trim() && <p><button type="button" className="secondary compact" onClick={() => setKeyFilter('')}>Showing one user ({keyFilter}). Clear ×</button></p>}
      <h3>Errors per day</h3>
      <ChartContainer config={errorConfig} className="usage-chart">
        <BarChart data={report.byDay} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
          <YAxis width={28} allowDecimals={false} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="n" fill="var(--color-n)" radius={3} />
        </BarChart>
      </ChartContainer>
      {report.byVersion.length > 0 && (
        <>
          <h3>By platform and app version</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Platform</th><th>Version</th><th>Errors</th><th>Users</th></tr></thead>
              <tbody>{report.byVersion.map((v) => <tr key={`${v.platform}${v.version}`}><td>{v.platform}</td><td>{v.version}</td><td>{v.n}</td><td>{v.users}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <h3>Events</h3>
      <p className="muted">Showing {report.rows.length + more.length} of {total}. Only the category, code and screen are recorded, never the error text or any data. Each user appears as a short key: click one to see only that person, or type an email above.</p>
      {report.rows.length === 0 ? <p className="muted">No errors recorded for these filters.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Category</th><th>Code</th><th>Screen</th><th>Platform</th><th>Version</th><th>User</th></tr></thead>
            <tbody>
              {[...report.rows, ...more].map((r, i) => (
                <tr key={`${r.ts}${i}`}>
                  <td>{new Date(r.ts).toLocaleString()}</td><td>{label(r.area)}</td><td>{label(r.code)}</td>
                  <td>{r.screen ? label(r.screen) : '—'}</td><td>{r.platform}</td><td>{r.version ?? '—'}</td><td>{r.user ? <button type="button" className="linkish" onClick={() => setKeyFilter(r.user!)}>{r.user}</button> : 'signed out'}{r.internal && <span className="set-badge"> Internal</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!moreDone && <p><button type="button" className="secondary compact" disabled={paging} onClick={() => void loadMore()}>{paging ? 'Loading…' : 'Load more'}</button></p>}
      <h2>Admin actions</h2>
      <p className="muted">What super admins changed or started from the console, newest first.</p>
      {actions.length === 0 ? <p className="muted">No admin actions yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Result</th></tr></thead>
            <tbody>{actions.map((a, i) => <tr key={`${a.at}${i}`}><td>{new Date(a.at).toLocaleString()}</td><td>{a.actor}</td><td>{label(a.action.replaceAll('-', '_'))}</td><td>{a.target ?? '—'}</td><td>{a.result}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
