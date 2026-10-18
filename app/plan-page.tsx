'use client';
// Plan: this month’s fresh money, the staircase of money put in so far, the shortlist and the latest Monthly Picks
// run. The run itself (and every shortlisted company) lives on the Monthly Picks page.
import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { money, type Portfolio } from '@/lib/portfolio';
import { moneyInFlows } from '@/lib/performance';
import { timeSeriesOption } from '@/lib/chart-kit';
import { EChart } from './charts/echart';
import { TickerTile } from './ui-kit';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? ''} ${m.slice(0, 4)}`;

export default function PlanPage({
  portfolio: p,
  month,
  onOpenPicks,
  onOpenCompany,
}: {
  portfolio: Portfolio;
  month: string;
  onOpenPicks: () => void;
  onOpenCompany: (ticker: string) => void;
}) {
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
      <div className="page-head">
        <p className="page-kicker">Monthly SIP</p>
        <h2>{monthName(month)}</h2>
      </div>
      <section className="slab plan-slab" aria-label="This month">
        <div className="slab-stats plan-stats">
          <div>
            <span className="lbl">Fresh money</span>
            <b className="num slab-value">{money(fresh)}</b>
          </div>
          <div>
            <span className="lbl">Put in this month</span>
            <span className="num">{money(thisMonth)}</span>
          </div>
          <div>
            <span className="lbl">Still to put in</span>
            <span className="num">{money(left)}</span>
          </div>
        </div>
        <div className="plan-bar" role="img" aria-label={`${Math.round(share)}% of this month’s money is in`}>
          <i style={{ width: `${share}%` }} />
        </div>
      </section>
      <section className="panel">
        <div className="between">
          <h3>Money put in, month by month</h3>
          <span className="muted-note">Each step is a month with a purchase</span>
        </div>
        {stairs.length ? (
          <EChart
            className="report-chart report-chart--trend"
            label={`Cumulative money put in, ${money(stairs[stairs.length - 1].total)} to date.`}
            build={(t) =>
              timeSeriesOption(t, {
                name: 'Put in',
                data: stairs.map((s) => ({ x: monthName(s.month), y: s.total })),
                categorical: true,
                step: true,
                area: true,
                includeZero: true,
                zoom: false,
                valueFormat: money,
                dateLabel: (x) => String(x),
              })
            }
          />
        ) : (
          <p className="muted-note">Record purchases to see your staircase.</p>
        )}
      </section>
      <section className="panel">
        <div className="between">
          <h3>Your shortlist</h3>
          <button type="button" data-slot="sw-link" className="sw-link" onClick={onOpenPicks}>
            Open Monthly Picks <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
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
            {picks.map((pk, i) => (
              <li key={pk.ticker}>
                <span className="num muted-note">#{i + 1}</span>
                <TickerTile ticker={pk.ticker} />
                <div>
                  <b>{pk.ticker}</b>
                  <small>{pk.allocationPct}% of the month’s money</small>
                </div>
                <b className="num">{money(Math.floor((fresh * pk.allocationPct) / 100))}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-note">Run Monthly Picks to see where this month’s money could go.</p>
        )}
      </section>
    </div>
  );
}
