'use client';

import { useCallback, useEffect, useState } from 'react';
import { DayBars, DayLine } from './charts/day-charts';
import type { UsageReport } from '@/lib/analytics-store';
import { readJson } from '@/lib/safe-json';
import { EChart } from './charts/echart';
import { hBarOption, heatmapOption } from '@/lib/chart-kit';

const label = (name: string) => {
  const t = name.replaceAll('_', ' ');
  return t[0].toUpperCase() + t.slice(1);
};
const pct = (n: number) => `${Math.round(n * 100)}%`;
const shortDay = (d: string) => d.slice(5);

/** Super-admin usage analytics (GET /api/admin/usage): sign-ups, active users, feature use, funnel, retention. */
export default function UsageDashboard({
  includeInternal,
  days = 30,
}: { includeInternal?: boolean; days?: number } = {}) {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ownToggle, setOwnToggle] = useState(false);
  const includeAdmin = includeInternal ?? ownToggle;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/usage?days=${days}${includeAdmin ? '&admin=1' : ''}`,
        { cache: 'no-store' },
      );
      const body = (await readJson(res)) as UsageReport & { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not load usage.');
      setReport(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load usage.');
    } finally {
      setLoading(false);
    }
  }, [includeAdmin, days]);
  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  if (error)
    return (
      <p className="muted" role="alert">
        {error}
      </p>
    );
  if (!report) return <p className="muted">Loading…</p>;
  const { active } = report;
  const maxUsers = Math.max(1, ...report.features.map((f) => f.users));
  const top = report.funnel[0]?.users || 0;

  return (
    <div className="system-health usage-dashboard">
      <div className="usage-kpis">
        {(
          [
            ['Total users', report.totalUsers],
            ['New sign-ups, 7 days', report.signups7],
            [`New sign-ups, ${report.days} days`, report.signups30],
            ['Active today', active.dau],
            ['Active, 7 days', active.wau],
            ['Active, 30 days', active.mau],
          ] as const
        ).map(([name, value]) => (
          <div key={name} className="usage-kpi">
            <small className="lbl">{name}</small>
            <strong className="num">{value.toLocaleString()}</strong>
          </div>
        ))}
      </div>
      <p className="muted">
        Stickiness (today ÷ 30 days):{' '}
        {active.stickiness === null ? 'n/a' : pct(active.stickiness)}. Super
        admins and test accounts are left out unless you include them. Sign-ups
        count accounts first seen since usage tracking began; accounts that
        already existed are in Total users only.
      </p>

      <h3>Active users per day</h3>
      <DayLine
        rows={report.dailyActive}
        pick={(d) => d.users}
        name="Active users"
        dayText={shortDay}
      />

      <h3>New sign-ups per day</h3>
      {report.signupSeries.length ? (
        <DayBars
          rows={report.signupSeries}
          pick={(d) => d.n}
          name="New sign-ups"
          dayText={shortDay}
        />
      ) : (
        <p className="muted">No new sign-ups in the last 30 days.</p>
      )}

      <h3>Sign-up funnel (last {report.days} days)</h3>
      {report.funnel.length ? (
        <EChart
          className="usage-chart usage-chart--funnel"
          label={`Sign-up funnel: ${report.funnel.map((f) => `${f.step} ${f.users}`).join(', ')}.`}
          build={(t) =>
            hBarOption(t, {
              name: 'People',
              cats: report.funnel.map((f) => f.step),
              values: report.funnel.map((f) => f.users),
              valueFormat: (n) => String(n),
              labelFormat: (n) => (top ? `${n} · ${pct(n / top)}` : String(n)),
              color: t.primary,
              max: Math.max(1, top) * 1.25,
              rows: (i) => [{ label: 'Of first step', value: top ? pct(report.funnel[i].users / top) : '–' }],
            })
          }
        />
      ) : (
        <p className="muted">No funnel data yet.</p>
      )}
      <p className="muted">
        The first two steps count anonymous browsers (this device only); the
        rest count signed-in accounts.
      </p>

      <h3>Most used features (last {report.days} days)</h3>
      {report.features.length ? (
        <>
          <EChart
            className="usage-chart usage-chart--rank"
            height={Math.max(180, report.features.length * 30 + 30)}
            label={`Most used features: ${report.features.slice(0, 5).map((f) => `${label(f.event)} ${f.users}`).join(', ')}.`}
            build={(t) =>
              hBarOption(t, {
                name: 'Users',
                cats: report.features.map((f) => label(f.event)),
                values: report.features.map((f) => f.users),
                valueFormat: (n) => String(n),
                color: t.primary,
                max: maxUsers * 1.2,
                rows: (i) => [
                  { label: 'Times', value: String(report.features[i].count) },
                  { label: 'Web', value: String(report.features[i].web) },
                  { label: 'Phone', value: String(report.features[i].phone) },
                ],
              })
            }
          />
          <details className="usage-details">
            <summary>Show table</summary>
            <table className="usage-table">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Users</th>
                  <th>Times</th>
                  <th>Web</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {report.features.map((f) => (
                  <tr key={f.event}>
                    <td>{label(f.event)}</td>
                    <td>{f.users}</td>
                    <td>{f.count}</td>
                    <td>{f.web}</td>
                    <td>{f.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      ) : (
        <p className="muted">No feature use recorded yet.</p>
      )}

      <h3>Screens viewed (last {report.days} days)</h3>
      {report.screens.length ? (
        <table className="usage-table">
          <thead>
            <tr>
              <th>Screen</th>
              <th>Users</th>
              <th>Views</th>
            </tr>
          </thead>
          <tbody>
            {report.screens.map((s) => (
              <tr key={s.screen}>
                <td>{label(s.screen)}</td>
                <td>{s.users}</td>
                <td>{s.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No screen views recorded yet.</p>
      )}

      <h3>Where users come from</h3>
      <div className="usage-split">
        <table className="usage-table">
          <caption>By platform (active in range)</caption>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Users</th>
              <th>Events</th>
            </tr>
          </thead>
          <tbody>
            {report.platforms.length ? (
              report.platforms.map((p) => (
                <tr key={p.platform}>
                  <td>{label(p.platform)}</td>
                  <td>{p.users}</td>
                  <td>{p.events}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="muted">
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <table className="usage-table">
          <caption>By app version</caption>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Version</th>
              <th>Users</th>
            </tr>
          </thead>
          <tbody>
            {report.versions.length ? (
              report.versions.map((v) => (
                <tr key={`${v.platform}${v.version}`}>
                  <td>{label(v.platform)}</td>
                  <td>{v.version}</td>
                  <td>{v.users}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="muted">
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <table className="usage-table">
          <caption>How accounts started</caption>
          <thead>
            <tr>
              <th>Origin</th>
              <th>Accounts</th>
            </tr>
          </thead>
          <tbody>
            {report.origins.length ? (
              report.origins.map((o) => (
                <tr key={o.origin}>
                  <td>{label(o.origin)}</td>
                  <td>{o.n}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} className="muted">
                  No accounts yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3>Sign-ups by channel (last {report.days} days)</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th>Channel</th>
            <th>Sign-ups</th>
          </tr>
        </thead>
        <tbody>
          {report.channels.length ? (
            report.channels.map((c) => (
              <tr key={c.channel}>
                <td>{label(c.channel)}</td>
                <td>{c.n}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={2} className="muted">
                No sign-ups yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h3>Imports (last {report.days} days)</h3>
      <table className="usage-table">
        <thead>
          <tr>
            <th>Step</th>
            <th>People</th>
          </tr>
        </thead>
        <tbody>
          {report.imports.map((r) => (
            <tr key={r.event}>
              <td>{label(r.event)}</td>
              <td>{r.users}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Weekly retention</h3>
      {report.retention.length ? (
        <>
          <EChart
            className="usage-chart usage-chart--cohort"
            height={Math.max(150, report.retention.length * 34 + 50)}
            label={`Weekly retention for ${report.retention.length} sign-up weeks.`}
            build={(t) =>
              heatmapOption(t, {
                cols: report.retention[0].retained.map((_, i) => (i === 0 ? 'Wk 0' : `+${i}`)),
                rows: report.retention.map((c) => `${c.week} · ${c.size}`),
                cells: report.retention.flatMap((c, row) =>
                  c.retained.flatMap((r, col): [number, number, number][] =>
                    r === null ? [] : [[col, row, r * 100]],
                  ),
                ),
                color: t.primary,
                valueFormat: (n) => `${Math.round(n)}%`,
                title: (col, row) =>
                  `${report.retention[row].week} · ${report.retention[row].size} users · ${col === 0 ? 'week 0' : `week +${col}`}`,
              })
            }
          />
          <details className="usage-details">
            <summary>Show table</summary>
            <div className="usage-scroll">
              <table className="usage-table">
                <thead>
                  <tr>
                    <th>Sign-up week</th>
                    <th>Users</th>
                    {report.retention[0].retained.map((_, i) => (
                      <th key={i}>{i === 0 ? 'Wk 0' : `+${i}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.retention.map((c) => (
                    <tr key={c.week}>
                      <td>{c.week}</td>
                      <td>{c.size}</td>
                      {c.retained.map((r, i) => (
                        <td key={i}>{r === null ? '' : pct(r)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : (
        <p className="muted">Retention appears after the first sign-ups.</p>
      )}

      {report.errors.length > 0 && (
        <>
          <h3>Failures (last {report.days} days)</h3>
          <table className="usage-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Users</th>
                <th>Times</th>
              </tr>
            </thead>
            <tbody>
              {report.errors.map((e) => (
                <tr key={e.event}>
                  <td>{label(e.event)}</td>
                  <td>{e.users}</td>
                  <td>{e.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {includeInternal === undefined && (
        <label className="usage-toggle">
          <input
            type="checkbox"
            checked={ownToggle}
            onChange={(e) => setOwnToggle(e.target.checked)}
          />{' '}
          Include internal accounts
        </label>
      )}
      <button
        type="button"
        className="secondary compact"
        disabled={loading}
        onClick={() => void load()}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
