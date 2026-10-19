'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- bars are CSS drawings described with role=img, style cards are a radio group of buttons, status lines are live regions */
// First run (a three-step wizard with a live preview) and the plan editor it shares with "Edit your SIP".
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { money } from '@/lib/portfolio';
import {
  SIP_BUDGET_PILLS,
  SIP_CLASSES,
  SIP_CLASS_LABELS,
  SIP_PRESETS,
  SIP_PRESET_ORDER,
  blendedReturn,
  lakh,
  planMonth,
  presetTargets,
  projectSip,
  setTarget,
  targetsTotal,
  type SipBlueprint,
  type SipClass,
  type SipPresetKey,
} from '@/lib/sip-blueprint';
import { classWeights, type SipRates } from '@/lib/sip-blueprint-data';

type Parts = Parameters<typeof classWeights>[0];

export type EditorValue = {
  budget: number;
  day: number;
  preset: SipPresetKey;
  targets: Record<SipClass, number>;
  strict: boolean;
  notify: boolean;
};

export function editorFrom(b: SipBlueprint | null): EditorValue {
  return {
    budget: b?.budget ?? 25_000,
    day: b?.day ?? 1,
    preset: b?.preset ?? 'balanced',
    targets: b ? { ...b.targets } : presetTargets('balanced'),
    strict: b?.strict ?? false,
    notify: b?.notify ?? true,
  };
}

const digits = (text: string) => Number(text.replace(/[^0-9]/g, '')) || 0;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** A switch that reads as one: label and hint beside a track. */
export function SpSwitch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-slot="sp-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="sp-switch-track" aria-hidden="true">
        <i />
      </span>
      <span className="sp-switch-text">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}

/** One horizontal bar split by class. */
export function MixBar({ shares, label }: { shares: Record<SipClass, number>; label: string }) {
  return (
    <span className="sp-mix" role="img" aria-label={`${label}: ${SIP_CLASSES.map((k) => `${SIP_CLASS_LABELS[k]} ${Math.round(shares[k])}%`).join(', ')}`}>
      {SIP_CLASSES.filter((k) => shares[k] > 0.4).map((k) => (
        <i key={k} data-class={k} style={{ flexGrow: shares[k] }} />
      ))}
    </span>
  );
}

export function PlanEditor({
  value: v,
  onChange,
  withSwitches,
  only,
}: {
  value: EditorValue;
  onChange: (v: EditorValue) => void;
  parts?: Parts;
  rates?: SipRates;
  asOf?: string;
  withSwitches?: boolean;
  /** Show only one part (the wizard shows one at a time). */
  only?: 'amount' | 'style';
}) {
  const set = (patch: Partial<EditorValue>) => onChange({ ...v, ...patch });
  return (
    <div className="sp-editor">
      {only !== 'style' && (
        <>
          <label className="sp-amount">
            <span>Monthly amount</span>
            <span className="sp-amount-field">
              <em>Rs</em>
              <input
                inputMode="numeric"
                aria-label="Monthly amount in rupees"
                value={v.budget ? v.budget.toLocaleString('en-US') : ''}
                onChange={(e) => set({ budget: digits(e.target.value) })}
                placeholder="25,000"
              />
            </span>
          </label>
          <div className="sp-pills" role="group" aria-label="Quick amounts">
            {SIP_BUDGET_PILLS.map((n) => (
              <button key={n} type="button" data-slot="sp-pill" aria-pressed={v.budget === n} onClick={() => set({ budget: n })}>
                {n >= 100_000 ? '1 lakh' : `${n / 1000}k`}
              </button>
            ))}
          </div>
          <label className="sp-day">
            <span>
              Your SIP day <small>Most people pick the day after payday.</small>
            </span>
            <select value={v.day} onChange={(e) => set({ day: Number(e.target.value) })}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {ordinal(d)} of every month
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {only !== 'amount' && (
        <>
          <div className="sp-styles" role="radiogroup" aria-label="Investing style">
            {SIP_PRESET_ORDER.map((key) => {
              const t = key === 'custom' ? (v.preset === 'custom' ? v.targets : SIP_PRESETS.balanced.targets) : SIP_PRESETS[key].targets;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  data-slot="sp-style"
                  aria-checked={v.preset === key}
                  onClick={() => set({ preset: key, targets: key === 'custom' ? { ...t } : presetTargets(key) })}
                >
                  <span className="sp-style-top">
                    <b>{key === 'custom' ? 'Custom' : SIP_PRESETS[key].label}</b>
                    {key === 'balanced' && <em>Popular</em>}
                    <small className="num">~{blendedReturn(t).toFixed(0)}%/yr</small>
                  </span>
                  <small>{key === 'custom' ? 'Set your own split.' : SIP_PRESETS[key].blurb}</small>
                  <MixBar shares={t} label="Split" />
                </button>
              );
            })}
          </div>
          {v.preset === 'custom' ? (
            <div className="sp-sliders">
              {SIP_CLASSES.map((k) => (
                <label key={k} className="sp-slider" data-class={k}>
                  <span>
                    <i aria-hidden="true" />
                    {SIP_CLASS_LABELS[k]}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={v.targets[k]}
                    style={{ '--fill': `${v.targets[k]}%` } as React.CSSProperties}
                    onChange={(e) => set({ targets: setTarget(v.targets, k, Number(e.target.value)) })}
                  />
                  <b className="num">{v.targets[k]}%</b>
                </label>
              ))}
              <p className="sp-hint">Moving one slider shifts the others, so the total always stays at 100%.</p>
            </div>
          ) : (
            <ul className="sp-split-legend">
              {SIP_CLASSES.filter((k) => v.targets[k] > 0).map((k) => (
                <li key={k} data-class={k}>
                  <i aria-hidden="true" />
                  {SIP_CLASS_LABELS[k]} <b className="num">{v.targets[k]}%</b>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {withSwitches && (
        <div className="sp-switches">
          <SpSwitch
            checked={!v.strict}
            onChange={(on) => set({ strict: !on })}
            label="Rebalance with new money"
            hint="Each month leans toward whatever is below its target. Nothing is ever sold."
          />
          <SpSwitch
            checked={v.notify}
            onChange={(on) => set({ notify: on })}
            label="Nudge me if I fall behind"
            hint="A reminder on this page from three days after your SIP day."
          />
        </div>
      )}
    </div>
  );
}

const STEPS = ['Amount', 'Style', 'Your plan'] as const;

export function SipWizard({
  parts,
  rates,
  asOf,
  busy,
  onStart,
}: {
  parts: Parts;
  rates: SipRates;
  asOf: string;
  busy: boolean;
  onStart: (v: EditorValue) => Promise<unknown>;
}) {
  const [step, setStep] = useState(0);
  const [v, setV] = useState<EditorValue>(() => editorFrom(null));
  const [error, setError] = useState('');
  const held = useMemo(() => classWeights(parts, asOf, rates), [parts, asOf, rates]);
  const plan = planMonth(v.budget, v.targets, held.weights, v.strict);
  const annual = blendedReturn(v.targets);
  const in10 = projectSip({ monthly: v.budget, years: 10, annualPct: annual, stepUpPct: 10 }).at(-1)!;
  const valid = v.budget > 0 && targetsTotal(v.targets) === 100;

  return (
    <section className="sp-wizard" aria-labelledby="sp-wizard-title">
      <div className="slab sp-wizard-intro">
        <span className="lbl">
          <Sparkles size={14} aria-hidden="true" /> My SIP
        </span>
        <h2 id="sp-wizard-title" className="sp-wizard-title">
          A plan you can follow every month.
        </h2>
        <p>Pick an amount and a style once. Each month Sipwise tells you exactly what to buy, ticks it off as you go and keeps your streak.</p>
        <ol className="sp-stepper" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} data-state={i < step ? 'done' : i === step ? 'now' : 'next'}>
              <span className="num">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </div>
      <div className="panel sp-wizard-body">
        <div className="sp-wizard-main">
          {step === 0 && (
            <>
              <h3 className="sp-q">How much can you invest each month?</h3>
              <PlanEditor value={v} onChange={setV} only="amount" />
            </>
          )}
          {step === 1 && (
            <>
              <h3 className="sp-q">How do you want it split?</h3>
              <PlanEditor value={v} onChange={setV} only="style" />
            </>
          )}
          {step === 2 && (
            <>
              <h3 className="sp-q">Your first month</h3>
              <ul className="sp-preview-rows">
                {SIP_CLASSES.filter((k) => plan[k] > 0).map((k) => (
                  <li key={k} data-class={k}>
                    <i aria-hidden="true" />
                    <span>{SIP_CLASS_LABELS[k]}</span>
                    <b className="num">{money(plan[k])}</b>
                  </li>
                ))}
              </ul>
              <div className="sp-switches">
                <SpSwitch
                  checked={!v.strict}
                  onChange={(on) => setV({ ...v, strict: !on })}
                  label="Rebalance with new money"
                  hint={held.weights ? 'Leans this month toward what you hold too little of. Nothing is sold.' : 'Kicks in once you hold something.'}
                />
                <SpSwitch
                  checked={v.notify}
                  onChange={(on) => setV({ ...v, notify: on })}
                  label="Nudge me if I fall behind"
                />
              </div>
            </>
          )}
          {error && <p className="notice error">{error}</p>}
          <div className="sp-wizard-nav">
            {step > 0 && (
              <button type="button" className="secondary" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
            )}
            {step < 2 ? (
              <button type="button" disabled={!valid} onClick={() => setStep(step + 1)}>
                Continue <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                disabled={busy || !valid}
                onClick={() => {
                  setError('');
                  void onStart(v).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'));
                }}
              >
                Start my SIP
              </button>
            )}
          </div>
        </div>
        <aside className="sp-wizard-preview" aria-label="Preview">
          <span className="lbl">Every month</span>
          <b className="num sp-preview-big">{money(v.budget)}</b>
          <MixBar shares={v.targets} label="Your split" />
          <p className="sp-hint">on the {ordinal(v.day)}</p>
          <div className="sp-preview-future">
            <span className="lbl">In 10 years, about</span>
            <b className="num">{lakh(in10.value)}</b>
            <small>
              You put in {lakh(in10.invested)} (rising 10% a year). At ~{annual.toFixed(0)}% a year. An illustration, not a promise.
            </small>
          </div>
        </aside>
      </div>
    </section>
  );
}
