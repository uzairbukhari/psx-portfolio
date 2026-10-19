'use client';
// SIP Blueprint: set a monthly budget and a split across asset classes, get this month's plan (fresh money goes to
// whatever sits below its target, nothing is sold), tick it off and watch the streak. Every figure is computed here
// from the decrypted ledger and public rates; the blueprint is saved only inside the encrypted portfolio.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { barOption } from '@/lib/chart-kit';
import { CURRENCY_NAMES, SUPPORTED_CURRENCIES, chooseFxRate, type CurrencyCode } from '@/lib/fx-rates';
import { chooseRate } from '@/lib/metal-rates';
import { money, today } from '@/lib/portfolio';
import {
  SIP_BUDGET_PILLS,
  SIP_CLASSES,
  SIP_CLASS_LABELS,
  SIP_PRESETS,
  SIP_PRESET_ORDER,
  STREAK_THRESHOLD,
  blankBlueprint,
  encouragement,
  gramsFor,
  monthProgress,
  planMonth,
  presetTargets,
  setTarget,
  sipHistory,
  targetsTotal,
  type SipBlueprint,
  type SipClass,
  type SipPresetKey,
} from '@/lib/sip-blueprint';
import {
  classWeights,
  mergeActual,
  moneyInByMonth,
  startOfMonthWeights,
  totalsByMonth,
  type QuickEntry,
  type SipRates,
} from '@/lib/sip-blueprint-data';
import { EChart } from './charts/echart';
import { InsightCard, Ring } from './insight-card';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const digits = (text: string) => Number(text.replace(/[^0-9]/g, '')) || 0;
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

type Parts = Parameters<typeof classWeights>[0];

export default function SipTracker({
  parts,
  blueprint,
  rates,
  busy,
  canLog,
  hasStocks,
  onSave,
  onLog,
  onOpenPicks,
  onOpenHoldings,
}: {
  parts: Parts;
  blueprint: SipBlueprint | null;
  rates: SipRates;
  busy: boolean;
  /** At least one portfolio can take a new entry (not locked). */
  canLog: boolean;
  hasStocks: boolean;
  onSave: (next: SipBlueprint, message: string) => Promise<unknown>;
  onLog: (entry: QuickEntry, next: SipBlueprint) => Promise<unknown>;
  onOpenPicks: () => void;
  onOpenHoldings: () => void;
}) {
  const asOf = today();
  const month = asOf.slice(0, 7);

  // ── Step 1: the blueprint being edited ──
  const [budgetText, setBudgetText] = useState(String(blueprint?.budget ?? SIP_BUDGET_PILLS[1]));
  const [preset, setPreset] = useState<SipPresetKey>(blueprint?.preset ?? 'balanced');
  const [custom, setCustom] = useState(blueprint?.preset === 'custom' ? blueprint.targets : presetTargets('balanced'));
  const [strict, setStrict] = useState(blueprint?.strict ?? false);
  const [notify, setNotify] = useState(blueprint?.notify ?? false);
  const [error, setError] = useState('');
  // Start again from what is saved whenever the saved blueprint changes (after a save or from another device).
  useEffect(() => {
    if (!blueprint) return;
    setBudgetText(String(blueprint.budget));
    setPreset(blueprint.preset);
    if (blueprint.preset === 'custom') setCustom(blueprint.targets);
    setStrict(blueprint.strict);
    setNotify(blueprint.notify);
  }, [blueprint]);
  const budget = digits(budgetText);
  const targets = preset === 'custom' ? custom : presetTargets(preset);
  const dirty =
    !blueprint ||
    blueprint.budget !== budget ||
    blueprint.preset !== preset ||
    blueprint.strict !== strict ||
    blueprint.notify !== notify ||
    SIP_CLASSES.some((k) => blueprint.targets[k] !== targets[k]);

  async function saveBlueprint() {
    setError('');
    if (budget <= 0) return setError('Enter a monthly budget above zero.');
    if (targetsTotal(targets) !== 100) return setError('The split must add up to 100%.');
    const base = blueprint ?? blankBlueprint(month, budget);
    const months = { ...base.months };
    // A month with nothing ticked takes the new plan straight away; a started month keeps the plan it began with.
    if (months[month] && !Object.keys(months[month].done).length) delete months[month];
    try {
      await onSave({ ...base, budget, preset, targets, strict, notify, months }, 'SIP blueprint saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the blueprint.');
    }
  }

  // ── Step 2: this month's plan ──
  const held = useMemo(() => classWeights(parts, asOf, rates), [parts, asOf, rates]);
  const ledger = useMemo(() => moneyInByMonth(parts, asOf, rates), [parts, asOf, rates]);
  const startWeights = useMemo(() => startOfMonthWeights(held.values, ledger[month]), [held, ledger, month]);
  const snapshot = blueprint?.months[month];
  const plan = useMemo(
    () => (blueprint ? (snapshot?.plan ?? planMonth(blueprint.budget, blueprint.targets, startWeights, blueprint.strict)) : null),
    [blueprint, snapshot, startWeights],
  );
  const merged = useMemo(() => mergeActual(ledger, blueprint?.months ?? {}), [ledger, blueprint]);
  const actualNow = merged[month] ?? {};
  const progress = plan ? monthProgress(plan, actualNow) : null;
  const history = useMemo(
    () => (blueprint ? sipHistory(blueprint, totalsByMonth(merged), month) : null),
    [blueprint, merged, month],
  );
  const monthBudget = snapshot?.budget ?? blueprint?.budget ?? 0;

  // ── Step 3: ticking things off ──
  const [logging, setLogging] = useState<SipClass | null>(null);
  function snapshotWith(done: NonNullable<typeof snapshot>['done']): SipBlueprint {
    return {
      ...blueprint!,
      months: { ...blueprint!.months, [month]: { budget: monthBudget, plan: plan!, done } },
    };
  }
  const untick = (k: SipClass) => {
    const { [k]: _gone, ...rest } = snapshot?.done ?? {};
    return onSave(snapshotWith(rest), `${SIP_CLASS_LABELS[k]} unmarked.`);
  };

  return (
    <div className="sb-page">
      {/* ── Progress ── */}
      <section className="slab sb-hero" aria-label="This month">
        <div className="sb-hero-main">
          <span className="lbl">{blueprint ? `${monthName(month)} blueprint` : 'SIP Blueprint'}</span>
          {progress && plan ? (
            <>
              <b className="num slab-value sb-big">{money(progress.done)}</b>
              <p className="mu">
                of {money(progress.planned)} allocated · <b>{progress.percent}% done</b>
              </p>
              {history && (
                <p className="sb-note" role="status">
                  {encouragement(history.streak, history.thisMonthMet, progress.percent)}
                </p>
              )}
            </>
          ) : (
            <>
              <b className="slab-value sb-big">Plan your monthly SIP</b>
              <p className="mu">
                Pick a budget and a split below. Sipwise turns it into a checklist for each month and keeps your streak.
              </p>
            </>
          )}
        </div>
        {progress && (
          <Ring
            percent={progress.percent}
            label="Completed this month"
            tone={progress.percent >= 100 ? 'success' : progress.percent >= 80 ? 'primary' : 'warn'}
          />
        )}
      </section>

      {/* ── Step 1: the blueprint ── */}
      <section className="panel sb-card" aria-labelledby="sb-blueprint">
        <div className="sb-head">
          <div>
            <p className="lbl">Step 1</p>
            <h2 id="sb-blueprint">Your SIP blueprint</h2>
          </div>
        </div>
        <label className="sb-field">
          Total monthly budget (Rs)
          <input
            inputMode="numeric"
            value={budget ? budget.toLocaleString('en-US') : ''}
            onChange={(e) => setBudgetText(e.target.value)}
            placeholder="25,000"
            aria-describedby="sb-budget-hint"
          />
        </label>
        <div className="sb-pills" role="group" aria-label="Quick budgets" id="sb-budget-hint">
          {SIP_BUDGET_PILLS.map((n) => (
            <button key={n} type="button" data-slot="sb-pill" aria-pressed={budget === n} onClick={() => setBudgetText(String(n))}>
              Rs {n.toLocaleString('en-US')}
            </button>
          ))}
        </div>

        <div className="sb-presets" role="group" aria-label="Allocation template">
          {SIP_PRESET_ORDER.map((key) => {
            const t = key === 'custom' ? custom : SIP_PRESETS[key].targets;
            return (
              <button key={key} type="button" data-slot="sb-preset" aria-pressed={preset === key} onClick={() => setPreset(key)}>
                <b>
                  {key === 'custom' ? 'Custom split' : SIP_PRESETS[key].label}
                  {key === 'balanced' && <em> Recommended</em>}
                </b>
                <small>{key === 'custom' ? 'Set your own percentages.' : SIP_PRESETS[key].blurb}</small>
                <span className="sb-mix" aria-hidden="true">
                  {SIP_CLASSES.filter((k) => t[k] > 0).map((k) => (
                    <i key={k} data-class={k} style={{ flexGrow: t[k] }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className="sb-split" aria-label="Target split">
          {SIP_CLASSES.map((k) => (
            <div key={k} className="sb-split-row">
              <span className="sb-dot" data-class={k} aria-hidden="true" />
              <label htmlFor={`sb-t-${k}`}>{SIP_CLASS_LABELS[k]}</label>
              {preset === 'custom' ? (
                <input
                  id={`sb-t-${k}`}
                  type="range"
                  min={0}
                  max={100}
                  value={custom[k]}
                  onChange={(e) => setCustom(setTarget(custom, k, Number(e.target.value)))}
                />
              ) : (
                <span className="sb-track" aria-hidden="true">
                  <i style={{ width: `${targets[k]}%` }} data-class={k} />
                </span>
              )}
              <b className="num">{targets[k]}%</b>
            </div>
          ))}
          <p className="mu sb-sum">
            {preset === 'custom' ? 'Moving one slider adjusts the others so the total stays 100%.' : 'Switch to Custom split to change the percentages.'}
          </p>
        </div>

        <label className="sb-check">
          <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
          <span>
            Keep strict split regardless of current holdings
            <small>Off: fresh money leans toward whatever is below its target. Nothing is ever sold.</small>
          </span>
        </label>
        <label className="sb-check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>
            Remind me when the month is behind
            <small>Shows a reminder on this page after the 20th if less than {Math.round(STREAK_THRESHOLD * 100)}% is done.</small>
          </span>
        </label>
        {error && <p className="notice error">{error}</p>}
        <div className="row">
          <button type="button" disabled={busy || !dirty} onClick={() => void saveBlueprint()}>
            {blueprint ? 'Save changes' : 'Create my blueprint'}
          </button>
          {blueprint && snapshot && Object.keys(snapshot.done).length > 0 && (
            <span className="mu">This month is already started, so changes apply from next month.</span>
          )}
        </div>
      </section>

      {blueprint && plan && history && progress && (
        <>
          {/* ── Steps 2 and 3: the plan and the checklist ── */}
          <section className="panel sb-card" aria-labelledby="sb-month">
            <div className="sb-head">
              <div>
                <p className="lbl">Step 2 and 3</p>
                <h2 id="sb-month">This month’s blueprint</h2>
              </div>
              <span className="mu">
                {blueprint.strict ? 'Strict split' : held.weights ? 'Adjusted for what you hold' : 'Nothing held yet, so the plain split'}
              </span>
            </div>
            {blueprint.notify && !history.thisMonthMet && Number(asOf.slice(8)) >= 20 && progress.percent < STREAK_THRESHOLD * 100 && (
              <p className="notice" role="alert">
                {progress.percent}% done and the month is nearly over. Finish {money(Math.max(0, Math.round(monthBudget * STREAK_THRESHOLD) - progress.done))} more to keep your streak.
              </p>
            )}
            <ol className="sb-steps">
              {SIP_CLASSES.filter((k) => plan[k] > 0 || blueprint.targets[k] > 0).map((k) => {
                const manual = snapshot?.done[k];
                const actual = actualNow[k] ?? 0;
                const done = !!manual || (plan[k] > 0 && actual >= plan[k] * 0.95);
                const weight = held.weights?.[k] ?? 0;
                const gap = weight - blueprint.targets[k];
                return (
                  <li key={k} className="sb-step" data-done={done || undefined} data-class={k}>
                    <button
                      type="button"
                      data-slot="sb-tick"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={`${SIP_CLASS_LABELS[k]}: ${done ? 'done' : 'not done'}`}
                      disabled={busy || plan[k] <= 0}
                      onClick={() =>
                        manual
                          ? void untick(k).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'))
                          : setLogging(k)
                      }
                    >
                      {done && <Check size={16} aria-hidden="true" />}
                    </button>
                    <div className="sb-step-main">
                      <div className="sb-step-top">
                        <b>{SIP_CLASS_LABELS[k]}</b>
                        <b className="num">{money(plan[k])}</b>
                      </div>
                      <p className="mu">
                        {suggestion(k, plan[k], rates, asOf)}
                      </p>
                      <p className="sb-drift">
                        {held.weights
                          ? `Now ${weight.toFixed(0)}% of your holdings · target ${blueprint.targets[k]}% · ${
                              Math.abs(gap) < 1 ? 'on target' : gap < 0 ? 'below target' : 'above target'
                            }`
                          : `Target ${blueprint.targets[k]}%`}
                      </p>
                      {actual > 0 && (
                        <p className="sb-paid">
                          {money(Math.min(actual, plan[k]))} of {money(plan[k])} in
                          {actual > plan[k] ? ` (+${money(actual - plan[k])} extra)` : ''}
                        </p>
                      )}
                      {k === 'stocks' && !done && (
                        <button type="button" className="secondary compact sb-cta" onClick={hasStocks ? onOpenPicks : onOpenHoldings}>
                          {hasStocks ? 'Open Monthly Picks' : 'Add a stock in Holdings'} <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      )}
                      {k === 'funds' && !done && (
                        <button type="button" className="secondary compact sb-cta" onClick={onOpenHoldings}>
                          Open Holdings <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="mu sb-foot">
              Buying anything in Sipwise counts on its own. Tick a step to log a purchase here or to mark it done.
            </p>
          </section>

          {/* ── Step 4: consistency ── */}
          <InsightCard
            eyebrow="Step 4"
            title={
              history.streak > 0
                ? `${history.streak}-month streak${history.thisMonthMet ? '' : ' (finish this month to extend it)'}`
                : 'Your streak starts with this month'
            }
            info={`A month counts when at least ${Math.round(STREAK_THRESHOLD * 100)}% of its budget went in, across stocks, funds, gold and currency. The running month never breaks a streak until it ends.`}
            size="wide"
            source={`Longest streak ${history.longest} month${history.longest === 1 ? '' : 's'}. Months before your blueprint began are not judged.`}
          >
            <EChart
              className="sb-chart"
              label="Money put in each month against your target"
              build={(t) =>
                barOption(t, {
                  cats: history.rows.map((r) => MONTHS[Number(r.month.slice(5, 7)) - 1]),
                  series: [
                    { name: 'Target', data: history.rows.map((r) => r.target), color: t.neutral },
                    { name: 'Put in', data: history.rows.map((r) => r.actual), color: t.primary },
                  ],
                  valueFormat: money,
                  legend: true,
                  catTitle: (c) => c,
                })
              }
            />
          </InsightCard>
        </>
      )}

      {logging && plan && blueprint && (
        <LogDialog
          klass={logging}
          planned={plan[logging]}
          already={actualNow[logging] ?? 0}
          rates={rates}
          asOf={asOf}
          canLog={canLog}
          busy={busy}
          onClose={() => setLogging(null)}
          onMark={async (amount, date) => {
            await onSave(
              snapshotWith({ ...(snapshot?.done ?? {}), [logging]: { amount, date } }),
              `${SIP_CLASS_LABELS[logging]} marked done.`,
            );
            setLogging(null);
          }}
          onLog={async (entry, amount) => {
            await onLog(entry, snapshotWith({ ...(snapshot?.done ?? {}), [logging]: { amount, date: entry.date } }));
            setLogging(null);
          }}
        />
      )}
    </div>
  );
}

/** What to buy with this amount, in plain words. Grams use the rate Sipwise already holds; no number is made up. */
function suggestion(k: SipClass, amount: number, rates: SipRates, asOf: string): string {
  if (amount <= 0) return 'Nothing planned this month.';
  if (k === 'stocks') return 'Buy from your shortlist, or pick the strongest names in Monthly Picks.';
  if (k === 'funds') return 'A money market or income fund (low risk), or a savings plan.';
  if (k === 'gold') {
    const rate = chooseRate(rates.metalRates ?? [], 'gold', asOf);
    const grams = gramsFor(amount, rate?.pkrPerGram);
    if (!rate || grams === null) return `${money(amount)} in gold. The price is not available right now.`;
    return `${money(amount)} ≈ ${grams.toFixed(grams < 1 ? 3 : 2)} g of 24K gold at ${money(rate.pkrPerGram)}/g${rate.stale ? ' (rate is old)' : ''}.`;
  }
  const usd = chooseFxRate(rates.fxRates ?? [], 'USD', asOf);
  return usd
    ? `Cash reserve in dollars, dirhams or riyals: ${money(amount)} ≈ US$${(amount / usd.pkrPerUnit).toFixed(0)} at ${money(usd.pkrPerUnit)}.`
    : 'Cash reserve in dollars, dirhams or riyals.';
}

function LogDialog({
  klass,
  planned,
  already,
  rates,
  asOf,
  canLog,
  busy,
  onClose,
  onMark,
  onLog,
}: {
  klass: SipClass;
  planned: number;
  already: number;
  rates: SipRates;
  asOf: string;
  canLog: boolean;
  busy: boolean;
  onClose: () => void;
  onMark: (amount: number, date: string) => Promise<unknown>;
  onLog: (entry: QuickEntry, amount: number) => Promise<unknown>;
}) {
  const loggable = canLog && (klass === 'gold' || klass === 'currency');
  const [mode, setMode] = useState<'log' | 'mark'>(loggable ? 'log' : 'mark');
  const [amountText, setAmountText] = useState(String(Math.max(0, Math.round(planned - already)) || planned));
  const [date, setDate] = useState(asOf);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [quantityText, setQuantityText] = useState('');
  const [error, setError] = useState('');
  const amount = digits(amountText);
  const rate =
    klass === 'gold' ? chooseRate(rates.metalRates ?? [], 'gold', asOf)?.pkrPerGram : chooseFxRate(rates.fxRates ?? [], currency, asOf)?.pkrPerUnit;
  const suggested = klass === 'currency' ? (rate ? amount / rate : null) : gramsFor(amount, rate);
  const quantity = quantityText === '' ? (suggested ?? 0) : Number(quantityText);

  async function submit(e: React.SyntheticEvent) {
    e.preventDefault();
    setError('');
    if (!(amount > 0)) return setError('Enter the rupees you spent.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > asOf) return setError('Choose a date that is not in the future.');
    try {
      if (mode === 'mark') return await onMark(amount, date);
      if (!(quantity > 0)) return setError(klass === 'currency' ? 'Enter how many units you bought.' : 'Enter the grams you bought.');
      const entry: QuickEntry =
        klass === 'currency'
          ? { class: 'currency', date, currency, units: Math.round(quantity * 1e4) / 1e4, pkr: amount }
          : { class: 'gold', date, grams: Math.round(quantity * 1e6) / 1e6, amount };
      await onLog(entry, amount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="form-dialog tx-dialog">
        <DialogTitle>{SIP_CLASS_LABELS[klass]}</DialogTitle>
        <DialogDescription>
          {mode === 'log'
            ? 'This adds a purchase to your encrypted ledger and ticks the step.'
            : klass === 'stocks' || klass === 'funds'
              ? 'Record the purchase in Holdings so it also counts in your ledger. This only ticks the step.'
              : 'This only ticks the step. Nothing is added to your holdings.'}
        </DialogDescription>
        <form onSubmit={(e) => void submit(e)}>
          {loggable && (
            <fieldset className="tx-types">
              <legend className="sr-only">What to do</legend>
              {(['log', 'mark'] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} className={mode === m ? 'compact' : 'secondary compact'} onClick={() => setMode(m)}>
                  {m === 'log' ? 'Log the purchase' : 'Just tick it'}
                </button>
              ))}
            </fieldset>
          )}
          <div className="form-grid">
            <label>
              Rupees spent
              <input
                inputMode="numeric"
                value={amount ? amount.toLocaleString('en-US') : ''}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </label>
            <label>
              Date
              <input type="date" value={date} max={asOf} onChange={(e) => setDate(e.target.value)} />
            </label>
            {mode === 'log' && klass === 'currency' && (
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
                {klass === 'currency' ? `${currency} bought` : 'Grams of 24K bought'}
                <input
                  inputMode="decimal"
                  value={quantityText !== '' ? quantityText : suggested ? String(Math.round(suggested * 1000) / 1000) : ''}
                  onChange={(e) => setQuantityText(e.target.value.replace(/[^0-9.]/g, ''))}
                />
              </label>
            )}
          </div>
          {mode === 'log' && (
            <p className="mu">
              {rate ? `Filled in from today’s public rate of ${money(rate)}${klass === 'currency' ? '' : ' per gram'}. Change it to match your receipt.` : 'No public rate is available, so enter it from your receipt.'}
            </p>
          )}
          {error && <p className="notice error">{error}</p>}
          <div className="row tx-actions">
            <button type="submit" disabled={busy}>
              {mode === 'log' ? 'Log it' : 'Mark done'}
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
