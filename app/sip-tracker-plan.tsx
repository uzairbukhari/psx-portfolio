'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- bars are CSS drawings described with role=img, style cards are a radio group of buttons, status lines are live regions */
// The running month: the hero (progress, SIP day, streak, last twelve months), the plan rows you tick off, and the
// habit card. Logging a purchase happens inline in its row.
import { useState } from 'react';
import { ArrowRight, Check, Flame, Minus, Pencil, Plus, RotateCcw } from 'lucide-react';
import { barOption } from '@/lib/chart-kit';
import { CURRENCY_NAMES, SUPPORTED_CURRENCIES, chooseFxRate, type CurrencyCode } from '@/lib/fx-rates';
import { TOLA_GRAMS, chooseRate } from '@/lib/metal-rates';
import { money } from '@/lib/portfolio';
import {
  SIP_CLASSES,
  SIP_CLASS_LABELS,
  STREAK_THRESHOLD,
  encouragement,
  gramsFor,
  lakh,
  mixAfter,
  nextSipDay,
  rebalanceEdit,
  type SipBlueprint,
  type SipClass,
  type SipDone,
} from '@/lib/sip-blueprint';
import type { QuickEntry, SipMonthState, SipRates } from '@/lib/sip-blueprint-data';
import { EChart } from './charts/echart';
import { MixBar } from './sip-tracker-setup';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLong = (m: string) =>
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][
    Number(m.slice(5, 7)) - 1
  ];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const shortDate = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const digits = (text: string) => Number(text.replace(/[^0-9]/g, '')) || 0;

export type PlanActions = {
  markDone: (k: SipClass, amount: number, date: string) => Promise<unknown>;
  undo: (k: SipClass) => Promise<unknown>;
  log: (k: SipClass, entry: QuickEntry, amount: number) => Promise<unknown>;
  savePlan: (plan: Record<SipClass, number>) => Promise<unknown>;
  resetPlan: () => Promise<unknown>;
  toggleRebalance: () => Promise<unknown>;
};

// ───────────────────────── hero ─────────────────────────

export function SipHero({ b, st, asOf, onEdit }: { b: SipBlueprint; st: SipMonthState; asOf: string; onEdit: () => void }) {
  const day = b.day ?? 1;
  const today = Number(asOf.slice(8));
  const left = Math.max(0, st.progress.planned - st.progress.done);
  const complete = st.progress.planned > 0 && left === 0;
  const next = nextSipDay(complete ? nextMonthStart(asOf) : asOf, day);
  const status = complete
    ? `Done for ${monthLong(st.month)}`
    : today === day
      ? 'Today is your SIP day'
      : today < day
        ? `SIP day in ${day - today} day${day - today === 1 ? '' : 's'}`
        : `SIP day was the ${ordinal(day)}`;
  return (
    <section className="slab sp-hero" aria-label={`${monthLong(st.month)} SIP`}>
      <div className="sp-hero-top">
        <span className="lbl">{monthLong(st.month)} SIP</span>
        <span className="sp-chip" data-tone={complete ? 'good' : today > day ? 'warn' : undefined}>
          {complete && <Check size={13} aria-hidden="true" />}
          {status}
        </span>
        {st.history.streak > 0 && (
          <span className="sp-chip" data-tone="streak">
            <Flame size={13} aria-hidden="true" />
            {st.history.streak}-month streak
          </span>
        )}
        <button type="button" data-slot="sp-ghost" className="sp-hero-edit" onClick={onEdit}>
          <Pencil size={14} aria-hidden="true" /> Edit plan
        </button>
      </div>
      <div className="sp-hero-main">
        <div>
          <b className="num sp-hero-big">{money(st.progress.done)}</b>
          <span className="sp-hero-of">
            of {money(st.progress.planned)} · {st.progress.percent}%
          </span>
        </div>
        {complete ? (
          <p className="sp-hero-next">
            Next SIP on <b>{shortDate(next.date)}</b>
          </p>
        ) : (
          <button
            type="button"
            className="sp-cta"
            onClick={() => document.querySelector('.sp-row:not([data-done])')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            Invest {money(left)} <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="sp-progress" role="img" aria-label={`${st.progress.percent}% of this month invested`}>
        {SIP_CLASSES.filter((k) => st.plan[k] > 0).map((k) => (
          <span key={k} data-class={k} style={{ flexGrow: st.plan[k] }}>
            <i style={{ width: `${Math.min(100, ((st.actual[k] ?? 0) / st.plan[k]) * 100)}%` }} />
          </span>
        ))}
      </div>
      <div className="sp-hero-foot">
        <ol className="sp-strip" aria-label="Last 12 months">
          {st.strip.map((s) => (
            <li
              key={s.month}
              data-state={s.state}
              title={`${monthLong(s.month)}: ${money(s.row.actual)}${s.row.target ? ` of ${money(s.row.target)}` : ''}`}
            >
              <i aria-hidden="true" />
              <small>{MONTHS[Number(s.month.slice(5, 7)) - 1][0]}</small>
              <span className="sr-only">
                {monthLong(s.month)}: {s.state}
              </span>
            </li>
          ))}
        </ol>
        <p className="sp-encourage">{encouragement(st.history.streak, st.history.thisMonthMet, st.progress.percent)}</p>
      </div>
    </section>
  );
}

function nextMonthStart(asOf: string) {
  const [y, m] = asOf.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

// ───────────────────────── plan rows ─────────────────────────

export function SipPlan({
  b,
  st,
  rates,
  asOf,
  busy,
  canLog,
  hasStocks,
  edited,
  manualDone,
  actions,
  onOpenPicks,
  onOpenHoldings,
  onEdit,
}: {
  b: SipBlueprint;
  st: SipMonthState;
  rates: SipRates;
  asOf: string;
  busy: boolean;
  canLog: boolean;
  hasStocks: boolean;
  edited: boolean;
  manualDone: Partial<Record<SipClass, SipDone>>;
  actions: PlanActions;
  onOpenPicks: () => void;
  onOpenHoldings: () => void;
  onEdit: () => void;
}) {
  const [draft, setDraft] = useState<Record<SipClass, number> | null>(null);
  const [open, setOpen] = useState<{ k: SipClass; mode: 'log' | 'mark' } | null>(null);
  const [error, setError] = useState('');
  const plan = draft ?? st.plan;
  const mix = draft ? mixAfter(st.values, draft) : st.mix;
  const anyDone = SIP_CLASSES.some((k) => st.done[k]);
  const run = (p: Promise<unknown>) => {
    setError('');
    return p.catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'));
  };
  const locked = SIP_CLASSES.filter((c) => st.done[c]);
  const free = SIP_CLASSES.filter((c) => !st.done[c] && (plan[c] > 0 || b.targets[c] > 0)).length;
  const step = (k: SipClass, by: number) => setDraft(rebalanceEdit(plan, k, plan[k] + by, st.budget, b.targets, locked));
  const today = Number(asOf.slice(8));
  const behind = b.notify && today >= (b.day ?? 1) + 3 && st.progress.percent < STREAK_THRESHOLD * 100;
  const rows = SIP_CLASSES.filter((k) => plan[k] > 0 || b.targets[k] > 0);

  return (
    <section className="panel sp-card" id="sp-plan" aria-labelledby="sp-plan-title">
      <div className="sp-card-head">
        <div>
          <h2 id="sp-plan-title">This month’s plan</h2>
          <p className="sp-sub">
            {money(st.budget)} across {rows.filter((k) => plan[k] > 0).length} steps
            {edited ? ' · adjusted by you' : b.strict ? ' · fixed split' : st.weights ? ' · tuned to what you hold' : ''}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!b.strict}
          data-slot="sp-switch"
          className="sp-switch-compact"
          aria-label="Rebalance with new money"
          disabled={busy}
          onClick={() => void run(actions.toggleRebalance())}
          title="Lean each month toward what you hold too little of. Nothing is sold."
        >
          <span className="sp-switch-track" aria-hidden="true">
            <i />
          </span>
          <span className="sp-switch-text">
            <b>Rebalance with new money</b>
          </span>
        </button>
      </div>

      {behind && (
        <p className="sp-nudge" role="status">
          Your SIP day was the {ordinal(b.day ?? 1)}. Invest {money(Math.max(0, Math.round(st.budget * STREAK_THRESHOLD) - st.progress.done))} more
          this month to keep your streak.
        </p>
      )}

      <ol className="sp-rows">
        {rows.map((k) => {
          const amount = plan[k];
          const actual = st.actual[k] ?? 0;
          const done = st.done[k];
          const target = Math.round((st.budget * b.targets[k]) / 100 / 100) * 100;
          const diff = amount - target;
          const isOpen = open?.k === k;
          const loggable = canLog && (k === 'gold' || k === 'currency');
          return (
            <li key={k} className="sp-row" data-class={k} data-done={done || undefined} data-open={isOpen || undefined}>
              <span className="sp-row-tick" aria-hidden="true">
                {done ? <Check size={16} /> : null}
              </span>
              <div className="sp-row-name">
                <b>{SIP_CLASS_LABELS[k]}</b>
                <small>{hint(k, amount, rates, asOf)}</small>
                {!done && Math.abs(diff) >= 100 && (
                  <span className="sp-tag" data-tone={diff > 0 ? 'up' : 'down'}>
                    {draft || edited
                      ? `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))} vs your split`
                      : diff > 0
                        ? `+${money(diff)} · below target`
                        : `−${money(-diff)} · above target`}
                  </span>
                )}
              </div>
              <div className="sp-row-amount">
                {done || free < 2 ? (
                  <b className="num">{money(amount)}</b>
                ) : (
                  <span className="sp-stepper">
                    <button type="button" data-slot="sp-step" aria-label={`Less to ${SIP_CLASS_LABELS[k]}`} disabled={amount <= 0} onClick={() => step(k, -500)}>
                      <Minus size={14} />
                    </button>
                    <b className="num">{money(amount)}</b>
                    <button type="button" data-slot="sp-step" aria-label={`More to ${SIP_CLASS_LABELS[k]}`} disabled={amount >= st.budget} onClick={() => step(k, 500)}>
                      <Plus size={14} />
                    </button>
                  </span>
                )}
                {amount > 0 && (
                  <span className="sp-row-bar" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, (actual / amount) * 100)}%` }} />
                  </span>
                )}
                {actual > 0 && (
                  <small className="sp-row-in">
                    {money(actual)} in{actual > amount && amount > 0 ? ' · more than planned' : ''}
                  </small>
                )}
              </div>
              <div className="sp-row-act">
                {done ? (
                  manualDone[k] ? (
                    <button type="button" data-slot="sp-ghost" disabled={busy} onClick={() => void run(actions.undo(k))}>
                      <RotateCcw size={14} aria-hidden="true" /> Undo
                    </button>
                  ) : (
                    <span className="sp-done">Done</span>
                  )
                ) : amount <= 0 ? (
                  <span className="sp-hint">Nothing this month</span>
                ) : draft ? null : (
                  <>
                    {k === 'stocks' && (
                      <button type="button" className="sp-act" onClick={hasStocks ? onOpenPicks : onOpenHoldings}>
                        {hasStocks ? 'Choose stocks' : 'Add stocks'} <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    )}
                    {k === 'funds' && (
                      <button type="button" className="sp-act" onClick={onOpenHoldings}>
                        Add to a fund <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    )}
                    {loggable && (
                      <button type="button" className="sp-act" aria-expanded={isOpen && open.mode === 'log'} onClick={() => setOpen(isOpen ? null : { k, mode: 'log' })}>
                        Log purchase
                      </button>
                    )}
                    <button type="button" data-slot="sp-ghost" aria-expanded={isOpen && open.mode === 'mark'} onClick={() => setOpen(isOpen && open.mode === 'mark' ? null : { k, mode: 'mark' })}>
                      Mark done
                    </button>
                  </>
                )}
              </div>
              {isOpen && (
                <RowForm
                  k={k}
                  mode={open.mode}
                  planned={Math.max(0, amount - actual) || amount}
                  rates={rates}
                  asOf={asOf}
                  busy={busy}
                  onCancel={() => setOpen(null)}
                  onMark={async (amt, date) => {
                    await actions.markDone(k, amt, date);
                    setOpen(null);
                  }}
                  onLog={async (entry, amt) => {
                    await actions.log(k, entry, amt);
                    setOpen(null);
                  }}
                />
              )}
            </li>
          );
        })}
      </ol>

      {draft && (
        <div className="sp-draftbar" role="status">
          <span>Plan changed. The total stays at {money(st.budget)}.</span>
          <button type="button" className="secondary compact" onClick={() => setDraft(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="compact"
            disabled={busy}
            onClick={() => void run(actions.savePlan(draft).then(() => setDraft(null)))}
          >
            Save this month
          </button>
        </div>
      )}
      {!draft && edited && !anyDone && (
        <button type="button" data-slot="sp-ghost" className="sp-reset" disabled={busy} onClick={() => void run(actions.resetPlan())}>
          <RotateCcw size={14} aria-hidden="true" /> Back to the suggested plan
        </button>
      )}
      {error && <p className="notice error">{error}</p>}

      <div className="sp-mixes">
        <span className="lbl">Your mix</span>
        {mix.now && (
          <div className="sp-mix-row">
            <span>Now</span>
            <MixBar shares={mix.now} label="Now" />
          </div>
        )}
        <div className="sp-mix-row">
          <span>After this month</span>
          <MixBar shares={mix.after} label="After this month" />
        </div>
        <div className="sp-mix-row">
          <span>Your target</span>
          <MixBar shares={b.targets} label="Target" />
        </div>
        <ul className="sp-split-legend">
          {SIP_CLASSES.filter((k) => b.targets[k] > 0 || (mix.now?.[k] ?? 0) > 0).map((k) => (
            <li key={k} data-class={k}>
              <i aria-hidden="true" />
              {SIP_CLASS_LABELS[k]}{' '}
              <b className="num">
                {mix.now ? `${Math.round(mix.now[k])}% → ` : ''}
                {Math.round(mix.after[k])}%
              </b>
              <small> / {b.targets[k]}%</small>
            </li>
          ))}
        </ul>
        <p className="sp-hint">
          {mix.now
            ? 'New money moves you toward your target without selling anything.'
            : 'Your first month sets your mix.'}{' '}
          <button type="button" data-slot="sp-link" onClick={onEdit}>
            Change target
          </button>
        </p>
      </div>
    </section>
  );
}

/** What to buy, in plain words. Grams and dollars use the public rate Sipwise already has. */
function hint(k: SipClass, amount: number, rates: SipRates, asOf: string): string {
  if (k === 'stocks') return 'From your shortlist or Monthly Picks';
  if (k === 'funds') return 'Money market or income fund, or a savings plan';
  if (k === 'gold') {
    const rate = chooseRate(rates.metalRates ?? [], 'gold', asOf);
    const g = gramsFor(amount, rate?.pkrPerGram);
    return rate && g !== null && amount > 0 ? `≈ ${g.toFixed(g < 1 ? 2 : 1)} g of 24K at ${lakh(rate.pkrPerGram * TOLA_GRAMS)}/tola` : '24K coins or bars';
  }
  const usd = chooseFxRate(rates.fxRates ?? [], 'USD', asOf);
  return usd && amount > 0 ? `≈ $${Math.round(amount / usd.pkrPerUnit).toLocaleString('en-US')} as a cash reserve` : 'Dollars, dirhams or riyals as a reserve';
}

function RowForm({
  k,
  mode,
  planned,
  rates,
  asOf,
  busy,
  onCancel,
  onMark,
  onLog,
}: {
  k: SipClass;
  mode: 'log' | 'mark';
  planned: number;
  rates: SipRates;
  asOf: string;
  busy: boolean;
  onCancel: () => void;
  onMark: (amount: number, date: string) => Promise<unknown>;
  onLog: (entry: QuickEntry, amount: number) => Promise<unknown>;
}) {
  const [amountText, setAmountText] = useState(String(planned));
  const [date, setDate] = useState(asOf);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [qtyText, setQtyText] = useState('');
  const [error, setError] = useState('');
  const amount = digits(amountText);
  const rate = k === 'gold' ? chooseRate(rates.metalRates ?? [], 'gold', asOf)?.pkrPerGram : chooseFxRate(rates.fxRates ?? [], currency, asOf)?.pkrPerUnit;
  const suggested = k === 'gold' ? gramsFor(amount, rate) : rate ? amount / rate : null;
  const qty = qtyText === '' ? (suggested ?? 0) : Number(qtyText);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError('');
    if (!(amount > 0)) return setError('Enter the rupees you spent.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > asOf) return setError('Pick a date that is not in the future.');
    try {
      if (mode === 'mark') return await onMark(amount, date);
      if (!(qty > 0)) return setError(k === 'gold' ? 'Enter the grams you bought.' : 'Enter how much you bought.');
      await onLog(
        k === 'gold'
          ? { class: 'gold', date, grams: Math.round(qty * 1e6) / 1e6, amount }
          : { class: 'currency', date, currency, units: Math.round(qty * 1e4) / 1e4, pkr: amount },
        amount,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  return (
    <form className="sp-rowform" onSubmit={(e) => void submit(e)}>
      <label>
        Rupees
        <input inputMode="numeric" value={amount ? amount.toLocaleString('en-US') : ''} onChange={(e) => setAmountText(e.target.value)} />
      </label>
      {mode === 'log' && k === 'currency' && (
        <label>
          Currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_NAMES[c]}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === 'log' && (
        <label>
          {k === 'gold' ? 'Grams (24K)' : `${currency} bought`}
          <input
            inputMode="decimal"
            value={qtyText !== '' ? qtyText : suggested ? String(Math.round(suggested * 1000) / 1000) : ''}
            onChange={(e) => setQtyText(e.target.value.replace(/[^0-9.]/g, ''))}
          />
        </label>
      )}
      <label>
        Date
        <input type="date" value={date} max={asOf} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="sp-rowform-actions">
        <button type="submit" className="compact" disabled={busy}>
          {mode === 'log' ? 'Save to ledger' : 'Mark done'}
        </button>
        <button type="button" className="secondary compact" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="sp-hint">
        {mode === 'log'
          ? rate
            ? 'Filled from today’s public rate. Match it to your receipt.'
            : 'No public rate right now, so enter it from your receipt.'
          : k === 'stocks' || k === 'funds'
            ? 'Only ticks the step. Record the purchase in Holdings so your ledger has it.'
            : 'Only ticks the step. Nothing is added to your holdings.'}
      </p>
      {error && <p className="notice error">{error}</p>}
    </form>
  );
}

// ───────────────────────── habit ─────────────────────────

export function SipHabit({ st }: { st: SipMonthState }) {
  const rows = st.history.rows;
  const active = rows.filter((r) => r.target > 0);
  const avg = active.length ? active.reduce((n, r) => n + r.actual, 0) / active.length : 0;
  return (
    <section className="panel sp-card sp-habit" aria-labelledby="sp-habit-title">
      <div className="sp-card-head">
        <div>
          <h2 id="sp-habit-title">Your habit</h2>
          <p className="sp-sub">A month counts when at least {Math.round(STREAK_THRESHOLD * 100)}% of its plan went in.</p>
        </div>
      </div>
      <div className="sp-stats">
        <div>
          <span className="lbl">Streak</span>
          <b className="num">{st.history.streak} mo</b>
        </div>
        <div>
          <span className="lbl">Longest</span>
          <b className="num">{st.history.longest} mo</b>
        </div>
        <div>
          <span className="lbl">This year</span>
          <b className="num">{lakh(st.year.invested)}</b>
        </div>
        <div>
          <span className="lbl">Average month</span>
          <b className="num">{lakh(avg)}</b>
        </div>
      </div>
      <EChart
        className="sp-habit-chart"
        label="Money put in each month and the plan, last 12 months"
        build={(t) =>
          barOption(t, {
            cats: rows.map((r) => MONTHS[Number(r.month.slice(5, 7)) - 1]),
            series: [
              { name: 'Plan', data: rows.map((r) => r.target), color: t.neutral },
              { name: 'Put in', data: rows.map((r) => r.actual), color: t.primary },
            ],
            valueFormat: money,
            axisFormat: (n) => lakh(n).replace('Rs ', ''),
            legend: true,
          })
        }
      />
    </section>
  );
}
