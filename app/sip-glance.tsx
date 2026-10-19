'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- the ring is an SVG drawing described with role=img */
// The SIP card on the Holdings dashboard: one ring slice per My SIP step, sized by its share of the month's plan and
// filled as money goes in, with the steps listed beside it. Same numbers as the My SIP page (`sipMonthState`), worked
// out on the device from the encrypted blueprint and the ledger.
import { useMemo } from 'react';
import { ArrowRight, Check, Flame } from 'lucide-react';
import { money } from '@/lib/portfolio';
import { SIP_CLASSES, lakh, nextSipDay, type SipBlueprint, type SipClass } from '@/lib/sip-blueprint';
import { sipMonthState, type SipRates } from '@/lib/sip-blueprint-data';

type Parts = Parameters<typeof sipMonthState>[1];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_LABELS: Record<SipClass, string> = { stocks: 'PSX stocks', funds: 'Funds & savings', gold: 'Gold', currency: 'Foreign currency' };
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
/** Compact rupees for the step list: "20k", "1.34 lakh". */
const compact = (n: number) => {
  const v = Math.round(n);
  if (v < 1000) return v.toLocaleString('en-US');
  if (v < 100_000) return `${Number((v / 1000).toFixed(v < 10_000 ? 1 : 0))}k`;
  return lakh(v).replace('Rs ', '');
};

const R = 44;
const C = 2 * Math.PI * R;
const GAP = 3.2;

export default function SipGlance({
  b,
  parts,
  rates,
  asOf,
  onOpen,
}: {
  b: SipBlueprint;
  parts: Parts;
  rates: SipRates;
  asOf: string;
  /** Opens My SIP, at a step when one is given. */
  onOpen: (step?: SipClass) => void;
}) {
  const st = useMemo(() => sipMonthState(b, parts, asOf, rates), [b, parts, asOf, rates]);
  const steps = SIP_CLASSES.filter((k) => st.plan[k] > 0);
  const planned = st.progress.planned;
  const left = Math.max(0, planned - st.progress.done);
  const complete = planned > 0 && left === 0;
  const doneCount = steps.filter((k) => st.done[k]).length;
  const day = b.day ?? 1;
  const today = Number(asOf.slice(8));
  const month = MONTHS[Number(st.month.slice(5, 7)) - 1];
  const next = complete ? nextSipDay(nextMonthStart(asOf), day) : null;
  const status = complete
    ? null
    : today === day
      ? 'Today is your SIP day'
      : today < day
        ? `SIP day in ${day - today} day${day - today === 1 ? '' : 's'}`
        : `SIP day was the ${ordinal(day)}`;

  // One arc per step: a dim track for the whole slice and a bright part for what is in.
  const gap = steps.length > 1 ? GAP : 0;
  const lens = steps.map((k) => Math.max(0, (C * st.plan[k]) / Math.max(1, planned) - gap));
  const arcs = steps.map((k, i) => ({
    k,
    len: lens[i],
    fill: Math.min(1, (st.actual[k] ?? 0) / st.plan[k]) * lens[i],
    offset: -lens.slice(0, i).reduce((n, l) => n + l + gap, 0),
  }));

  const meta = [complete ? 'Month done' : status, st.history.streak > 0 ? `${st.history.streak}-month streak` : null].filter(Boolean);

  return (
    <section className="card glance-sip sg" aria-label={`${month} SIP`}>
      <div className="sg-head">
        <span className="lbl">{month} SIP</span>
        {meta.length > 0 && (
          <span className="sg-meta" data-tone={complete ? 'good' : today > day ? 'warn' : undefined}>
            {st.history.streak > 0 && <Flame size={12} aria-hidden="true" />}
            {meta.join(' · ')}
          </span>
        )}
      </div>
      <div className="sg-main">
        <svg
          className="sg-ring"
          viewBox="0 0 104 104"
          role="img"
          aria-label={`${st.progress.percent}% of ${month}'s SIP invested, ${doneCount} of ${steps.length} steps done`}
        >
          <g transform="rotate(-90 52 52)">
            {arcs.map((a) => (
              <g key={a.k} data-class={a.k} className="sg-slice" onClick={() => onOpen(a.k)}>
                <circle cx="52" cy="52" r={R} className="sg-track" strokeDasharray={`${a.len} ${C}`} strokeDashoffset={a.offset} />
                {a.fill > 0 && (
                  <circle cx="52" cy="52" r={R} className="sg-fill" strokeDasharray={`${a.fill} ${C}`} strokeDashoffset={a.offset} />
                )}
              </g>
            ))}
          </g>
          <text x="52" y="55" textAnchor="middle" className="sg-pct">
            {complete ? 'Done' : `${st.progress.percent}%`}
          </text>
          <text x="52" y="69" textAnchor="middle" className="sg-steps">
            {doneCount}/{steps.length} steps
          </text>
        </svg>
        <div className="sg-body">
          <div className="num glance-big">{money(st.progress.done).replace(/\.\d+$/, '')}</div>
          <small className="sg-of">
            of {money(planned).replace(/\.\d+$/, '')}
            {left > 0 ? ` · ${money(left).replace(/\.\d+$/, '')} to go` : ''}
          </small>
          <ul className="sg-list">
            {steps.map((k) => {
              const togo = Math.max(0, st.plan[k] - (st.actual[k] ?? 0));
              return (
                <li key={k} data-class={k} data-done={st.done[k] || undefined}>
                  <button type="button" data-slot="sg-step" onClick={() => onOpen(k)}>
                    <i aria-hidden="true" />
                    <span className="sg-name">{SHORT_LABELS[k]}</span>
                    {st.done[k] ? (
                      <span className="sg-amt is-done">
                        <Check size={12} aria-hidden="true" /> {compact(st.plan[k])}
                      </span>
                    ) : (
                      <span className="sg-amt">{compact(togo)} to go</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="sg-foot">
        {complete ? (
          <span className="sg-next">
            Next SIP on {Number(next!.date.slice(8))} {MONTHS[Number(next!.date.slice(5, 7)) - 1].slice(0, 3)}
          </span>
        ) : (
          <button type="button" className="sg-cta" onClick={() => onOpen(steps.find((k) => !st.done[k]))}>
            Invest {money(left).replace(/\.\d+$/, '')} <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
        <button type="button" data-slot="link" className="sw-link" onClick={() => onOpen()}>
          Open My SIP
        </button>
      </div>
    </section>
  );
}

function nextMonthStart(asOf: string) {
  const [y, m] = asOf.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
