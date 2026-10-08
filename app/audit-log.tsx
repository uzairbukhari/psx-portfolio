'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuditReport } from '@/lib/analytics-store';
import { ERROR_AREAS } from '@/lib/error-codes';
import { readJson } from '@/lib/safe-json';

const label = (name: string) => { const t = name.replaceAll('_', ' '); return t[0].toUpperCase() + t.slice(1); };

/** Super-admin audit log (GET /api/admin/audit): errors users hit, by category and code. Never shows message text. */
export default function AuditLog() {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [code, setCode] = useState('');
  const [days, setDays] = useState(7);
  const [user, setUser] = useState('');
  const [includeAdmin, setIncludeAdmin] = useState(false);

  const load = useCallback(async () => {
    const q = new URLSearchParams({ days: String(days) });
    if (area) q.set('area', area);
    if (code) q.set('code', code);
    if (user.trim()) q.set('user', user.trim());
    if (includeAdmin) q.set('admin', '1');
    try {
      const res = await fetch(`/api/admin/audit?${q}`, { cache: 'no-store' });
      const body = (await readJson(res)) as AuditReport & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load the audit log.');
      setReport(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audit log.');
    }
  }, [area, code, days, user, includeAdmin]);
  useEffect(() => { void load(); }, [load]);

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
        <select aria-label="Time range" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 7, 30, 90, 180].map((d) => <option key={d} value={d}>{d === 1 ? 'Today' : `Last ${d} days`}</option>)}
        </select>
        <select aria-label="Error code" value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">All codes</option>
          {report.byCode.map((c) => <option key={`${c.area}${c.code}`} value={c.code}>{label(c.code)} ({c.n})</option>)}
        </select>
        <input aria-label="Filter by user email" placeholder="User email" value={user} onChange={(e) => setUser(e.target.value)} />
        <label><input type="checkbox" checked={includeAdmin} onChange={(e) => setIncludeAdmin(e.target.checked)} /> Include my own</label>
      </fieldset>
      <p className="muted">Showing the latest {report.rows.length} of {total}. Only the category, code and screen are recorded, never the error text or any data. Each user appears as a short key; type an email above to see one person&apos;s errors.</p>
      {report.rows.length === 0 ? <p className="muted">No errors recorded for these filters.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Category</th><th>Code</th><th>Screen</th><th>Platform</th><th>Version</th><th>User</th></tr></thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={`${r.ts}${i}`}>
                  <td>{new Date(r.ts).toLocaleString()}</td><td>{label(r.area)}</td><td>{label(r.code)}</td>
                  <td>{r.screen ? label(r.screen) : '—'}</td><td>{r.platform}</td><td>{r.version ?? '—'}</td><td>{r.user ?? 'signed out'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
