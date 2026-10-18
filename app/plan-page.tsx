'use client';
// Plan: this month’s fresh money, the staircase of money put in so far, the shortlist and the latest Monthly Picks
// run. The run itself (and every shortlisted company) lives on the Monthly Picks page.
import { useMemo, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { money, type Portfolio } from '@/lib/portfolio';
import { moneyInFlows } from '@/lib/performance';
import { barOption } from '@/lib/chart-kit';
import { EChart } from './charts/echart';
import { TickerTile } from './ui-kit';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function PlanPage({
  portfolio: p,
  month,
  setMonth,
  feePct,
  setFeePct,
  busy,
  onOpenPicks,
  onOpenCompany,
  onSetBudget,
}: {
  portfolio: Portfolio;
  month: string;
  setMonth: (m: string) => void;
  feePct: number;
  setFeePct: (n: number) => void;
  busy: boolean;
  onOpenPicks: () => void;
  onOpenCompany: (ticker: string) => void;
  onSetBudget: (amount: number) => Promise<unknown> | void;
}) {
  const [amountText, setAmountText] = useState('');
  const [editing, setEditing] = useState(false);
  const fresh = p.budgets[month] ?? 100000;
  const shortlist = p.monthlyPicksShortlist ?? [];
  const run = (p.monthlyPicksRuns ?? []).find((r) => r.status === 'completed' && r.result);
  const stairs = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const f of moneyInFlows(p).flows) byMonth.set(f.date.slice(0, 7), (byMonth.get(f.date.slice(0, 7)) ?? 0) + f.amount);
    let total = 0;
    return [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([m, amount]) => ({ month: m, amount, total: (total += amount) }));
  }, [p]);
  const thisMonth = stairs.find((s) => s.month === month)?.amount ?? 0;
  const left = Math.max(0, fresh - thisMonth);
  const picks = run?.result?.picks ?? [];
  const share = Math.min(100, (thisMonth / Math.max(1, fresh)) * 100);
  return (
    <div className="plan-page">
      <section className="slab plan-slab plan-hero" aria-label="This month">
        <div className="plan-hero-main">
          <span className="lbl">This month</span>
          <b className="num slab-value plan-big">{money(thisMonth)}</b>
          <p className="mu">
            of {money(fresh)} planned · <b>{money(left)} left</b>
          </p>
          <div className="plan-bar" role="img" aria-label={`${Math.round(share)}% of this month’s money is in`}>
            <i style={{ width: `${share}%` }} />
          </div>
        </div>
        <div className="plan-hero-chart">
          <span className="lbl">Your staircase · last 12 months</span>
          {stairs.length ? (
            <EChart
              className="plan-stair"
              label={`Money put in each month, ${money(stairs[stairs.length - 1].total)} to date.`}
              build={(t) =>
                barOption(t, {
                  cats: stairs.slice(-12).map((x) => MONTHS[Number(x.month.slice(5, 7)) - 1]),
                  series: [{ name: 'Put in', data: stairs.slice(-12).map((x) => x.amount), color: t.primary }],
                  valueFormat: money,
                })
              }
            />
          ) : (
            <p className="mu">Record purchases to see your staircase.</p>
          )}
        </div>
      </section>
      <div className="plan-lower">
      <section className="panel plan-fresh">
        <span className="lbl">Fresh money</span>
        <label className="plan-amount">
          <span>Rs</span>
          <input
            inputMode="numeric"
            aria-label="Fresh money this month"
            value={editing ? amountText : fresh.toLocaleString('en-PK')}
            onFocus={() => {
              setAmountText(String(fresh));
              setEditing(true);
            }}
            onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => {
              setEditing(false);
              const n = Number(amountText);
              if (Number.isFinite(n) && n > 0 && n !== fresh) void onSetBudget(n);
            }}
          />
        </label>
        <div className="plan-fields">
          <label>
            <span>Est. fees</span>
            <input
              inputMode="decimal"
              aria-label="Estimated fees percent"
              value={feePct}
              onChange={(e) => setFeePct(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)}
            />
          </label>
          <label>
            <span>Month</span>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
        <span className="lbl">Shortlist · {shortlist.length} of 15</span>
        {shortlist.length ? (
          <div className="chip-row">
            {shortlist.map((t) => (
              <button key={t} type="button" data-slot="chip" className="sym-chip" onClick={() => onOpenCompany(t)}>
                <TickerTile ticker={t} size={22} /> {t}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted-note">No shortlist yet. Add up to 15 companies on the Monthly Picks page.</p>
        )}
        <button type="button" data-slot="cta" className="plan-cta plan-generate" disabled={busy} onClick={onOpenPicks}>
          <Sparkles size={16} aria-hidden="true" /> Generate picks
        </button>
      </section>
      <section className="panel">
        <div className="between">
          <h3>Latest picks</h3>
          <button type="button" data-slot="sw-link" className="sw-link" onClick={onOpenPicks}>
            Open Monthly Picks <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
        {picks.length ? (
          <ul className="pick-list">
            {picks.map((pk, i) => {
              const co = p.companies.find((c) => c.ticker === pk.ticker);
              const price = p.quotes[pk.ticker]?.price;
              const amt = Math.floor((fresh * pk.allocationPct) / 100);
              return (
                <li key={pk.ticker}>
                  <span className="num muted-note">{i + 1}</span>
                  <TickerTile ticker={pk.ticker} />
                  <div>
                    <b>{pk.ticker}</b>
                    <small>{co?.name ?? ''}{co?.sector ? ` · ${co.sector}` : ''}</small>
                    <span className="pick-bar" aria-hidden="true">
                      <i style={{ width: `${Math.min(100, pk.allocationPct)}%` }} />
                    </span>
                  </div>
                  <span className="pick-amt">
                    <b className="num">{money(amt)}</b>
                    <small>{price ? `Buy ${Math.floor(amt / price)} sh @ ${money(price)}` : `${pk.allocationPct}% of the month’s money`}</small>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted-note">Run Monthly Picks to see where this month’s money could go.</p>
        )}
      </section>
      </div>
    </div>
  );
}
