/* oxlint-disable next/no-html-link-for-pages -- full page loads are intended: next/link throws in the vinext production build */
'use client';

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { AdminHealth } from '@/lib/admin-health';
import { delta, type Attention } from '@/lib/admin-overview';
import type { OverviewMetrics } from '@/lib/analytics-store';
import { Refresher, StatusPill } from './admin-status';
import { usd } from './admin-format';
import { useAdminData } from './use-admin-data';

type Overview = { health: AdminHealth; metrics: OverviewMetrics; attention: Attention[] };
const activeConfig = { users: { label: 'Active users', color: 'var(--primary)' } } satisfies ChartConfig;
const errorConfig = { n: { label: 'Client errors', color: 'var(--cat-2)' } } satisfies ChartConfig;
const shortDay = (d: string) => d.slice(5);

function Change({ now, before, goodWhen, suffix }: { now: number; before: number; goodWhen: 'up' | 'down'; suffix: string }) {
  const d = delta(now, before);
  if (d.sign === 'flat') return <span className="muted">No change {suffix}</span>;
  const good = d.sign === goodWhen;
  return <span className={good ? 'admin-up' : 'admin-down'}>{d.sign === 'up' ? '▲' : '▼'} {d.amount} {suffix}</span>;
}

/** The admin landing page: pipeline status strip, four numbers, what needs attention, two small trends. */
export default function AdminOverview({ includeInternal }: { includeInternal: boolean }) {
  const { data, error, loading, updatedAt, reload } = useAdminData<Overview>(`/api/admin/overview${includeInternal ? '?admin=1' : ''}`);
  if (error && !data) return <p role="alert" className="notice error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { health, metrics, attention } = data;
  const ai = health.aiSpend.sources.filter((s) => s.capUsd);
  const capped = ai.sort((a, b) => b.usd / (b.capUsd ?? 1) - a.usd / (a.capUsd ?? 1))[0];

  return (
    <div className="admin-overview">
      <Refresher updatedAt={updatedAt} loading={loading} onRefresh={() => void reload()} />
      {error && <p role="alert" className="notice error">{error}</p>}
      <div className="admin-strip" aria-label="Pipeline status">
        {health.pipelines.map((p) => (
          <a key={p.id} href="/admin/health#pipelines" title={p.expected}><StatusPill status={p.status} label={`${p.label}${p.status === 'ok' || p.status === 'idle' ? '' : p.ageMinutes === null ? ' · never' : ''}`} /></a>
        ))}
      </div>
      <div className="admin-kpis">
        <div className="admin-kpi"><small>Active today</small><strong>{metrics.activeToday}</strong><Change now={metrics.activeToday} before={metrics.activeLastWeek} goodWhen="up" suffix="vs same day last week" /></div>
        <div className="admin-kpi"><small>New sign-ups, 7 days</small><strong>{metrics.signups7}</strong><Change now={metrics.signups7} before={metrics.signupsPrev7} goodWhen="up" suffix="vs the 7 days before" /></div>
        <div className="admin-kpi"><small>Client errors, 24 hours</small><strong>{metrics.errors24h}</strong>
          {metrics.topError ? <span className="muted">Most: {metrics.topError.area} / {metrics.topError.code} ({metrics.topError.n})</span> : <Change now={metrics.errors24h} before={metrics.errorsPrev24h} goodWhen="down" suffix="vs the 24 hours before" />}
        </div>
        <div className="admin-kpi"><small>AI spend, {health.aiSpend.month}</small><strong>{usd(health.aiSpend.totalUsd)}</strong>
          {capped?.capUsd ? (<><span className="muted">{capped.label}: {usd(capped.usd)} of {usd(capped.capUsd)}</span><div className="admin-meter"><span style={{ width: `${Math.min(100, (capped.usd / capped.capUsd) * 100)}%` }} /></div></>) : <span className="muted">No monthly cap set</span>}
        </div>
      </div>
      <div className="admin-two">
        <section className="admin-panel">
          <h2>Needs attention</h2>
          {attention.length === 0 ? <p className="muted">Nothing needs attention right now.</p> : (
            <ul className="admin-attention">
              {attention.map((a, i) => (
                <li key={`${a.text}${i}`}>
                  <StatusPill status={a.level === 'info' ? 'idle' : a.level} label={a.level === 'failing' ? 'Failing' : a.level === 'late' ? 'Check' : 'Note'} />
                  <a href={`/admin/${a.section}`}>{a.text}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="admin-panel">
          <h2>Active users, 30 days</h2>
          <ChartContainer config={activeConfig} className="admin-spark">
            <LineChart data={metrics.dailyActive} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={32} />
              <YAxis width={24} allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="users" stroke="var(--color-users)" strokeWidth={2} dot={false} />
            </LineChart>
          </ChartContainer>
          <h2>Client errors per day</h2>
          <ChartContainer config={errorConfig} className="admin-spark">
            <BarChart data={metrics.errorSeries} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={32} />
              <YAxis width={24} allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="n" fill="var(--color-n)" radius={2} />
            </BarChart>
          </ChartContainer>
        </section>
      </div>
    </div>
  );
}
