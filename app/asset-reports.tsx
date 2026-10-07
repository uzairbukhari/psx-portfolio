'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { money, moneyShort, today, type Portfolio } from '@/lib/portfolio';
import {
  fundReport,
  planReport,
  metalReport,
  type MonthPoint,
  type ReportMode,
} from '@/lib/asset-reports';
import type { Metal, MetalRateRow } from '@/lib/metal-rates';
import type { FundNavRow } from '@/lib/mufap';
import type { PlanNavRow } from '@/lib/plans';

// Same fixed hue order as the stock reports (validated on the dark surface).
const colors = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
const OTHER = '#5b6b85';
const compact = (v: number) =>
  new Intl.NumberFormat('en-PK', { notation: 'compact' }).format(v);
const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PK', { month: 'short', year: '2-digit' }).format(new Date(y, m - 1, 1));
};
const dayLabel = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Intl.DateTimeFormat('en-PK', { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(y, m - 1, day));
};
const signed = (n: number) => `${n >= 0 ? '+' : ''}${moneyShort(n)}`;

const investedConfig = { invested: { label: 'Invested', color: 'var(--primary)' } } satisfies ChartConfig;
const cumulativeConfig = { cumulative: { label: 'Cumulative invested', color: 'var(--primary)' } } satisfies ChartConfig;

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="report-empty">{children}</div>;
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'pos' | 'neg' | '' }) {
  return (
    <div className={`reports-priced-value ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function MonthlyBars({ rows, eyebrow, source }: { rows: (MonthPoint & { label: string })[]; eyebrow: string; source: string }) {
  return (
    <section className="panel report-panel">
      <div className="report-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>Monthly purchase activity</h3>
        </div>
        <span>PKR invested, including fees</span>
      </div>
      {rows.length ? (
        <ChartContainer config={investedConfig} className="report-chart report-chart--activity">
          <BarChart accessibilityLayer data={rows} margin={{ top: 12, right: 10, bottom: 24, left: 16 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} label={{ value: 'Purchase month', position: 'insideBottom', offset: -16 }} />
            <YAxis width={72} tickFormatter={compact} label={{ value: 'Invested (PKR)', angle: -90, position: 'insideLeft' }} />
            <ChartTooltip content={<ChartTooltipContent formatter={(v) => <div className="report-tooltip-row"><span>Invested</span><b>{money(Number(v))}</b></div>} />} />
            <Bar dataKey="invested" fill="var(--color-invested)" radius={[5, 5, 0, 0]} maxBarSize={56} />
          </BarChart>
        </ChartContainer>
      ) : (
        <Empty>Record purchases to see monthly investment activity.</Empty>
      )}
      <p className="report-source">{source}</p>
    </section>
  );
}

function Trajectory({ rows, total, eyebrow, source }: { rows: (MonthPoint & { label: string })[]; total: number; eyebrow: string; source: string }) {
  return (
    <section className="panel report-panel">
      <div className="report-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>Cumulative invested</h3>
        </div>
        <span>{rows.length ? money(total) : '—'} to date</span>
      </div>
      {rows.length ? (
        <ChartContainer config={cumulativeConfig} className="report-chart report-chart--trend">
          <AreaChart accessibilityLayer data={rows} margin={{ top: 12, right: 10, bottom: 24, left: 16 }}>
            <defs>
              <linearGradient id="assetCumulativeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} label={{ value: 'Purchase month', position: 'insideBottom', offset: -16 }} />
            <YAxis width={72} tickFormatter={compact} />
            <ChartTooltip content={<ChartTooltipContent formatter={(v) => <div className="report-tooltip-row"><span>Cumulative invested</span><b>{money(Number(v))}</b></div>} />} />
            <Area type="monotone" dataKey="cumulative" stroke="var(--primary)" strokeWidth={2} fill="url(#assetCumulativeFill)" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }} />
          </AreaChart>
        </ChartContainer>
      ) : (
        <Empty>Record purchases to see your contribution trajectory.</Empty>
      )}
      <p className="report-source">{source}</p>
    </section>
  );
}

function FundReports({ portfolio, navs }: { portfolio: Portfolio; navs: FundNavRow[] }) {
  const report = fundReport(portfolio.assets ?? [], navs, today());
  const rows = report.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }));
  // Top seven funds by amount invested keep their own colour; the rest fold into "Other".
  const shown = report.funds.filter((f) => f.invested > 0).slice(0, 7);
  const shownIds = new Set(shown.map((f) => f.id));
  const hasOther = report.funds.some((f) => f.invested > 0 && !shownIds.has(f.id));
  const stacked = rows.map((m) => {
    const row: Record<string, number | string> = { label: m.label };
    for (const f of shown) row[f.id] = m.byAsset[f.id] ?? 0;
    if (hasOther) row.other = Object.entries(m.byAsset).filter(([id]) => !shownIds.has(id)).reduce((t, [, v]) => t + v, 0);
    return row;
  });
  const config: ChartConfig = Object.fromEntries([...shown.map((f) => [f.id, { label: f.name }]), ['other', { label: 'Other funds' }]]);
  const keys = [...shown.map((f, i) => ({ id: f.id, name: f.name, color: colors[i] })), ...(hasOther ? [{ id: 'other', name: 'Other funds', color: OTHER }] : [])];
  const last = rows.at(-1);
  return (
    <>
      <div className="reports-intro">
        <div className="reports-intro-header">
          <p className="eyebrow">MUTUAL FUND REPORTS</p>
          <p>How much you put into your funds, when, and where. Value uses each fund’s latest repurchase price.</p>
        </div>
        <div className="reports-hero-stats">
          <Stat label="Invested" value={moneyShort(report.invested)} note="Purchases, including fees" />
          <Stat label="Current value" value={report.value === null ? '—' : moneyShort(report.value)} note="Units × latest repurchase price" />
          <Stat label="Unrealised gain / loss" value={report.gain === null ? '—' : signed(report.gain)} note="Value less remaining cost" tone={report.gain === null ? '' : report.gain >= 0 ? 'pos' : 'neg'} />
          <Stat label="Dividends received" value={moneyShort(report.dividends)} note="Cash dividends recorded" />
        </div>
      </div>
      <div className="reports-grid" style={{ marginBottom: 20 }}>
        <Trajectory rows={rows} total={last?.cumulative ?? 0} eyebrow="SIP TRAJECTORY" source="Source: running total of non-voided fund purchases · opening balances, reinvested dividends and redemptions excluded" />
        <MonthlyBars rows={rows} eyebrow="CONTRIBUTION RHYTHM" source="Source: non-voided fund purchases · opening balances and redemptions excluded" />
        <section className="panel report-panel report-panel--wide">
          <div className="report-heading">
            <div>
              <p className="eyebrow">SIP ACTIVITY</p>
              <h3>Monthly investment by fund</h3>
            </div>
            <span>{money(report.invested)} invested</span>
          </div>
          {keys.length ? (
            <>
              <ChartContainer config={config} className="report-chart report-chart--medium">
                <BarChart accessibilityLayer data={stacked} margin={{ top: 12, right: 16, bottom: 24, left: 16 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} label={{ value: 'Month', position: 'insideBottom', offset: -16 }} />
                  <YAxis width={72} tickFormatter={compact} label={{ value: 'Invested (PKR)', angle: -90, position: 'insideLeft' }} />
                  <ChartTooltip cursor={{ fill: 'rgba(148,178,225,.12)' }} content={<ChartTooltipContent formatter={(v, name) => {
                    if (!Number(v)) return null;
                    const k = keys.find((x) => x.id === name);
                    return <div className="report-tooltip-row"><span>{k?.name ?? name}</span><b>{money(Number(v))}</b></div>;
                  }} />} />
                  {keys.map((k, i) => (
                    <Bar key={k.id} dataKey={k.id} stackId="invested" fill={k.color} radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ChartContainer>
              <div className="sector-key" aria-label="Fund legend">
                {keys.map((k) => {
                  const f = report.funds.find((x) => x.id === k.id);
                  const amount = f ? f.invested : report.funds.filter((x) => !shownIds.has(x.id)).reduce((t, x) => t + x.invested, 0);
                  return (
                    <div key={k.id}>
                      <i aria-hidden="true" style={{ background: k.color }} />
                      <span>{k.name}</span>
                      <b>{moneyShort(amount)}</b>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <Empty>Record fund purchases to see where each month went.</Empty>
          )}
          <p className="report-source">Source: non-voided purchases by fund</p>
        </section>
      </div>
    </>
  );
}

function PlanReports({ portfolio, navs }: { portfolio: Portfolio; navs: PlanNavRow[] }) {
  const report = planReport(portfolio.assets ?? [], navs, today());
  const rows = report.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const series = report.series.map((s) => ({ ...s, label: monthLabel(s.month) }));
  const config = {
    paidIn: { label: 'Paid in', color: '#7f93b8' },
    value: { label: 'Value', color: 'var(--primary)' },
  } satisfies ChartConfig;
  return (
    <>
      <div className="reports-intro">
        <div className="reports-intro-header">
          <p className="eyebrow">SAVINGS PLAN REPORTS</p>
          <p>What you paid into your savings plans against what they are worth. Values come from your dated statements, moved by the plan’s unit price or your assumed rate in between.</p>
        </div>
        <div className="reports-hero-stats">
          <Stat label="Paid in" value={moneyShort(report.paidIn)} note="All contributions" />
          <Stat label="Current value" value={moneyShort(report.value)} note="Latest statement, adjusted since" />
          <Stat label="Gain / loss" value={signed(report.gain)} note="Value plus redeemed, less paid in" tone={report.gain >= 0 ? 'pos' : 'neg'} />
          <Stat label="Redeemed" value={moneyShort(report.redeemed)} note="Cash taken out" />
        </div>
      </div>
      <div className="reports-grid" style={{ marginBottom: 20 }}>
        <section className="panel report-panel report-panel--wide">
          <div className="report-heading">
            <div>
              <p className="eyebrow">PLAN GROWTH</p>
              <h3>Paid in against value</h3>
            </div>
            <span>Month-end</span>
          </div>
          {series.length ? (
            <ChartContainer config={config} className="report-chart report-chart--medium">
              <LineChart accessibilityLayer data={series} margin={{ top: 12, right: 16, bottom: 24, left: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} label={{ value: 'Month', position: 'insideBottom', offset: -16 }} />
                <YAxis width={72} tickFormatter={compact} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v, name) => <div className="report-tooltip-row"><span>{name === 'value' ? 'Value' : 'Paid in'}</span><b>{money(Number(v))}</b></div>} />} />
                <Line type="monotone" dataKey="paidIn" stroke="#7f93b8" strokeWidth={2} strokeDasharray="6 4" dot={false} />
                <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }} />
              </LineChart>
            </ChartContainer>
          ) : (
            <Empty>Record contributions to see how your plan grows.</Empty>
          )}
          <p className="report-source">Source: contributions and statement values · dashed line is what you paid in</p>
        </section>
        <Trajectory rows={rows} total={rows.at(-1)?.cumulative ?? 0} eyebrow="SIP TRAJECTORY" source="Source: running total of non-voided plan contributions" />
        <MonthlyBars rows={rows} eyebrow="CONTRIBUTION RHYTHM" source="Source: non-voided plan contributions · redemptions excluded" />
      </div>
    </>
  );
}

const RANGES = [
  ['1Y', 365],
  ['3Y', 1095],
  ['5Y', 1825],
] as const;

function MetalReports({ portfolio, metal, rates }: { portfolio: Portfolio; metal: Metal; rates: MetalRateRow[] }) {
  const [range, setRange] = useState<(typeof RANGES)[number][0]>('5Y');
  const asOf = today();
  const report = metalReport(portfolio.assets ?? [], metal, rates, asOf);
  const name = metal === 'gold' ? 'Gold' : 'Silver';
  const days = RANGES.find(([k]) => k === range)![1];
  const from = new Date(Date.parse(`${asOf}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const history = report.history.filter((p) => p.date >= from);
  const rows = report.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const avg = report.averageCostPerTola;
  const config = { rate: { label: `${name} rate`, color: 'var(--primary)' } } satisfies ChartConfig;
  const domain: [number, number] | undefined = history.length
    ? [
        Math.floor(Math.min(...history.map((p) => p.rate), avg ?? Infinity) * 0.97),
        Math.ceil(Math.max(...history.map((p) => p.rate), avg ?? 0) * 1.03),
      ]
    : undefined;
  return (
    <>
      <div className="reports-intro">
        <div className="reports-intro-header">
          <p className="eyebrow">{name.toUpperCase()} REPORTS</p>
          <p>The {name.toLowerCase()} price over time against what you paid. Prices are per tola of pure metal; the dealer rate is used where recorded, otherwise the world price in rupees.</p>
        </div>
        <div className="reports-hero-stats">
          <Stat label="Held" value={`${report.grams.toFixed(2)} g`} note={`${(report.grams / 11.6638).toFixed(2)} tola`} />
          <Stat label="Current value" value={report.value === null ? '—' : moneyShort(report.value)} note={report.latest ? `Rate of ${dayLabel(report.latest.date)}` : 'No rate loaded yet'} />
          <Stat label="Average cost" value={avg === null ? '—' : `${moneyShort(avg)} / tola`} note={avg === null ? 'Needs a cost on every purchase' : 'Pure metal, all purchases'} />
          <Stat label="Unrealised gain / loss" value={report.gain === null ? '—' : signed(report.gain)} note="Value less remaining cost" tone={report.gain === null ? '' : report.gain >= 0 ? 'pos' : 'neg'} />
        </div>
      </div>
      <div className="reports-grid" style={{ marginBottom: 20 }}>
        <section className="panel report-panel report-panel--wide">
          <div className="report-heading">
            <div>
              <p className="eyebrow">{name.toUpperCase()} RATE</p>
              <h3>Rate history against your average cost</h3>
            </div>
            <div className="reports-tabs seg" aria-label="Range">
              {RANGES.map(([k]) => (
                <button key={k} type="button" data-active={range === k || undefined} onClick={() => setRange(k)}>{k}</button>
              ))}
            </div>
          </div>
          {history.length > 1 ? (
            <ChartContainer config={config} className="report-chart report-chart--medium">
              <LineChart accessibilityLayer data={history} margin={{ top: 12, right: 16, bottom: 24, left: 16 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={48} tickFormatter={monthLabel} />
                <YAxis width={72} domain={domain} tickFormatter={compact} label={{ value: 'PKR per tola', angle: -90, position: 'insideLeft' }} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => dayLabel(String(l))} formatter={(v, _n, item) => <div className="report-tooltip-row"><span>{item.payload.kind === 'local' ? 'Dealer rate' : 'World price in rupees'}</span><b>{money(Number(v))}</b></div>} />} />
                {avg !== null && <ReferenceLine y={avg} stroke="var(--warning, #c98500)" strokeDasharray="6 4" label={{ value: `Your average cost ${moneyShort(avg)}`, position: 'insideTopLeft', fill: 'var(--muted-foreground)', fontSize: 12 }} />}
                <Line type="monotone" dataKey="rate" stroke="var(--primary)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }} />
              </LineChart>
            </ChartContainer>
          ) : (
            <Empty>Not enough rate history yet. A point is saved each day the rates are collected.</Empty>
          )}
          <p className="report-source">
            Source: saved {name.toLowerCase()} rates ({history.length ? `${dayLabel(history[0].date)} to ${dayLabel(history.at(-1)!.date)}` : 'none yet'}) · dashed line is your average cost per tola of pure metal
          </p>
        </section>
        <Trajectory rows={rows} total={rows.at(-1)?.cumulative ?? 0} eyebrow="CUMULATIVE PURCHASES" source={`Source: running total of non-voided ${name.toLowerCase()} purchases · opening balances and sales excluded`} />
        <MonthlyBars rows={rows} eyebrow="CONTRIBUTION RHYTHM" source={`Source: non-voided ${name.toLowerCase()} purchases · opening balances and sales excluded`} />
      </div>
    </>
  );
}

export default function AssetReports({
  portfolio,
  mode,
  metalRates,
  fundNavs,
  planNavs,
}: {
  portfolio: Portfolio;
  mode: Exclude<ReportMode, 'stocks'>;
  metalRates: MetalRateRow[];
  fundNavs: FundNavRow[];
  planNavs: PlanNavRow[];
}) {
  const metals = (['gold', 'silver'] as const).filter((m) =>
    portfolio.assets?.some((a) => a.kind === 'metal' && a.metal === m),
  );
  return (
    <div className="reports">
      {mode === 'savings' ? (
        <>
          {portfolio.assets?.some((a) => a.kind === 'fund') && (
            <FundReports portfolio={portfolio} navs={fundNavs} />
          )}
          {portfolio.assets?.some((a) => a.kind === 'plan') && (
            <PlanReports portfolio={portfolio} navs={planNavs} />
          )}
        </>
      ) : (
        metals.map((m) => <MetalReports key={m} portfolio={portfolio} metal={m} rates={metalRates} />)
      )}
    </div>
  );
}
