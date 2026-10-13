'use client';

import { DayBars } from './charts/day-charts';
import type { PlatformReport } from '@/lib/admin-platform';
import { Refresher, StatusPill } from './admin-status';
import { ago, title } from './admin-format';
import { useAdminData } from './use-admin-data';

const level = (share: number) =>
  share >= 0.9 ? 'high' : share >= 0.7 ? 'mid' : 'low';

/** Super-admin Platform page (GET /api/admin/platform): Cloudflare limit meters, server errors, platform pages users saw. */
export default function AdminPlatform() {
  const {
    data: report,
    error,
    loading,
    updatedAt,
    reload,
  } = useAdminData<PlatformReport>('/api/admin/platform');
  if (error && !report)
    return (
      <p role="alert" className="notice error">
        {error}
      </p>
    );
  if (!report) return <p className="muted">Loading…</p>;
  const nowMs = Date.parse(report.now);
  const t = report.today;
  const cpuShare = t.cpuP99 === null ? 0 : t.cpuP99 / report.cpuLimitMs;

  return (
    <div className="system-health admin-platform">
      <Refresher
        updatedAt={updatedAt}
        loading={loading}
        onRefresh={() => void reload()}
      />
      <p
        className={report.status === 'failing' ? 'notice error' : 'notice'}
        role={report.status === 'failing' ? 'alert' : 'status'}
      >
        <StatusPill status={report.status} /> {report.headline}
      </p>

      <h2>Limits today (UTC)</h2>
      {!report.connected && (
        <p className="muted">
          Cloudflare&apos;s own numbers are not connected. Create an API token
          with <strong>Account Analytics: Read</strong>, then add it to the
          quote-refresh Worker as the secret <code>CF_ANALYTICS_TOKEN</code> and
          set <code>CF_ACCOUNT_ID</code> there. The server errors and
          browser-side counts below work without it.
          {report.lastSyncAt && (
            <> Last sync {ago(report.lastSyncAt, nowMs)}.</>
          )}
          {report.syncRanAt ? (
            report.syncError ? (
              <>
                {' '}
                <strong>
                  The last attempt ({ago(report.syncRanAt, nowMs)}) failed:{' '}
                  {report.syncError}.
                </strong>
              </>
            ) : (
              <>
                {' '}
                The last attempt ({ago(report.syncRanAt, nowMs)}) succeeded;
                refresh in a moment.
              </>
            )
          ) : (
            <>
              {' '}
              The cron Worker has not tried yet; it runs at 15 and 45 minutes
              past every hour.
            </>
          )}
        </p>
      )}
      <div className="admin-spend">
        <div className="admin-kpi">
          <small>Requests</small>
          <strong>{t.requests.toLocaleString()}</strong>
          <span className="muted">
            of {report.dailyRequestLimit.toLocaleString()} a day
          </span>
          <div className="admin-meter" data-level={level(t.usedShare)}>
            <span style={{ width: `${Math.min(100, t.usedShare * 100)}%` }} />
          </div>
        </div>
        <div className="admin-kpi">
          <small>CPU time per request (slowest 1%)</small>
          <strong>
            {t.cpuP99 === null ? 'n/a' : `${t.cpuP99.toFixed(1)} ms`}
          </strong>
          <span className="muted">limit {report.cpuLimitMs} ms</span>
          <div className="admin-meter" data-level={level(cpuShare)}>
            <span style={{ width: `${Math.min(100, cpuShare * 100)}%` }} />
          </div>
        </div>
        <div className="admin-kpi">
          <small>Limit hits</small>
          <strong>{t.limitHits.toLocaleString()}</strong>
          <span className="muted">requests Cloudflare refused or cut off</span>
        </div>
        <div className="admin-kpi">
          <small>Failed invocations</small>
          <strong>{t.errors.toLocaleString()}</strong>
          <span className="muted">includes limit hits</span>
        </div>
      </div>

      {t.scripts.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Worker</th>
                <th>Requests</th>
                <th>Failed</th>
                <th>Limit hits</th>
                <th>CPU p50 / p99</th>
                <th>Outcomes</th>
              </tr>
            </thead>
            <tbody>
              {t.scripts.map((s) => (
                <tr key={s.script}>
                  <td>{s.script}</td>
                  <td>{s.requests.toLocaleString()}</td>
                  <td>{s.errors.toLocaleString()}</td>
                  <td>{s.limitHits.toLocaleString()}</td>
                  <td>
                    {s.cpuP50 === null
                      ? 'n/a'
                      : `${s.cpuP50.toFixed(1)} / ${(s.cpuP99 ?? 0).toFixed(1)} ms`}
                  </td>
                  <td className="muted">
                    {Object.entries(s.statuses)
                      .map(([k, v]) => `${k} ${v.toLocaleString()}`)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.connected && (
        <>
          <h3>Requests, last 7 days</h3>
          <DayBars
            rows={report.days}
            pick={(d) => d.requests}
            name="Requests"
          />
        </>
      )}

      <h2>Server errors</h2>
      <p className="muted">
        Failures the Worker answered itself (HTTP 5xx), counted per route. A
        request Cloudflare cuts off before the Worker runs leaves no trace here;
        that is what the limits above are for.
      </p>
      <div className="admin-spend">
        <div className="admin-kpi">
          <small>Last 24 hours</small>
          <strong>{report.server.last24h}</strong>
          <span className="muted">
            {report.server.previous24h} the 24 hours before
          </span>
        </div>
        <div className="admin-kpi">
          <small>Last hour</small>
          <strong>{report.server.lastHour}</strong>
        </div>
      </div>
      <DayBars
        rows={report.server.series}
        pick={(d) => d.n}
        name="Server errors"
        danger
      />
      {report.server.byRoute.length === 0 ? (
        <p className="muted">No server errors in the last 24 hours.</p>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Route</th>
                <th>Kind</th>
                <th>Count</th>
                <th>Latest</th>
              </tr>
            </thead>
            <tbody>
              {report.server.byRoute.map((r) => (
                <tr key={`${r.route}${r.code}`}>
                  <td>{r.route}</td>
                  <td>{title(r.code)}</td>
                  <td>{r.n}</td>
                  <td>{ago(`${r.lastAt}:00Z`, nowMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Cloudflare pages people saw</h2>
      <p className="muted">
        When a browser or the phone gets Cloudflare&apos;s own error page
        instead of an answer, it records the kind (never the page). Last 7 days,
        internal accounts left out.
      </p>
      {report.client.length === 0 ? (
        <p className="muted">None recorded.</p>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Kind</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {report.client.map((c) => (
                <tr key={c.code}>
                  <td>{title(c.code.replace(/^cf_/, ''))}</td>
                  <td>{c.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
