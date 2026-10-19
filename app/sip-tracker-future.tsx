'use client';
// "Future you": what the habit becomes if it continues. Pure illustration from the person's own mix and assumptions;
// nothing here is a forecast and nothing leaves the device.
import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { stackedAreaOption } from '@/lib/chart-kit';
import {
  DEFAULT_RETURNS,
  SIP_CLASSES,
  SIP_CLASS_LABELS,
  blendedReturn,
  lakh,
  milestones,
  projectSip,
  skipCost,
  type SipBlueprint,
  type SipClass,
} from '@/lib/sip-blueprint';
import { LONG_RUN_INFLATION } from '@/lib/sip-blueprint-data';
import { EChart } from './charts/echart';
import { PillSwitch } from './insight-card';

const LEVELS = [1e6, 5e6, 1e7, 5e7];

export function SipFuture({
  b,
  busy,
  onSave,
}: {
  b: SipBlueprint;
  busy: boolean;
  onSave: (patch: Pick<SipBlueprint, 'stepUp' | 'returns'>) => Promise<unknown>;
}) {
  const [monthly, setMonthly] = useState(b.budget);
  const [years, setYears] = useState(15);
  const [stepUp, setStepUp] = useState(b.stepUp ?? 10);
  const [view, setView] = useState<'future' | 'today'>('future');
  const [tuning, setTuning] = useState(false);
  const [returns, setReturns] = useState<Record<SipClass, number>>({ ...DEFAULT_RETURNS, ...b.returns });
  const [error, setError] = useState('');
  const annual = blendedReturn(b.targets, returns);
  const points = useMemo(
    () => projectSip({ monthly, years, annualPct: annual, stepUpPct: stepUp, inflationPct: LONG_RUN_INFLATION }),
    [monthly, years, annual, stepUp],
  );
  const real = view === 'today';
  const last = points[points.length - 1];
  const value = real ? last.realValue : last.value;
  const invested = real ? last.realInvested : last.invested;
  const startYear = new Date().getFullYear();
  const marks = milestones(points.map((p) => ({ year: p.year, value: real ? p.realValue : p.value })), LEVELS);
  const skip = skipCost(b.budget, years, annual) / (real ? Math.pow(1 + LONG_RUN_INFLATION / 100, years) : 1);
  const changed =
    stepUp !== (b.stepUp ?? 10) || SIP_CLASSES.some((k) => returns[k] !== (b.returns?.[k] ?? DEFAULT_RETURNS[k]));

  return (
    <section className="panel sp-card sp-future" aria-labelledby="sp-future-title">
      <div className="sp-card-head">
        <div>
          <h2 id="sp-future-title">Future you</h2>
          <p className="sp-sub">If you keep going. Your mix at about {annual.toFixed(1)}% a year.</p>
        </div>
        <PillSwitch
          value={view}
          options={[
            { key: 'future', label: 'Future rupees' },
            { key: 'today', label: 'Today’s rupees' },
          ]}
          onChange={setView}
          label="Show amounts in"
        />
      </div>

      <div className="sp-future-grid">
        <div className="sp-future-head">
          <span className="lbl">
            In {years} year{years === 1 ? '' : 's'} ({startYear + years})
          </span>
          <b className="num sp-future-big">{lakh(value)}</b>
          <div className="sp-future-split">
            <span>
              <i data-k="in" aria-hidden="true" />
              You put in <b className="num">{lakh(invested)}</b>
            </span>
            <span>
              <i data-k="growth" aria-hidden="true" />
              Growth <b className="num">{lakh(Math.max(0, value - invested))}</b>
            </span>
          </div>
          <div className="sp-ranges">
            <Range label="Every month" value={monthly} min={5_000} max={500_000} step={5_000} format={lakh} onChange={setMonthly} />
            <Range label="For" value={years} min={1} max={30} step={1} format={(n) => `${n} yr${n === 1 ? '' : 's'}`} onChange={setYears} />
            <Range label="Raise it yearly by" value={stepUp} min={0} max={20} step={1} format={(n) => `${n}%`} onChange={setStepUp} />
          </div>
        </div>
        <div className="sp-future-chart">
          <EChart
            className="sp-future-canvas"
            label={`Projected value over ${years} years`}
            build={(t) =>
              stackedAreaOption(t, {
                dates: points.map((p) => `${startYear + p.year}-12-31`),
                series: [
                  { name: 'You put in', data: points.map((p) => Math.round(real ? p.realInvested : p.invested)), color: t.asset.funds },
                  {
                    name: 'Growth',
                    data: points.map((p) => Math.max(0, Math.round(real ? p.realValue - p.realInvested : p.value - p.invested))),
                    color: t.primary,
                  },
                ],
                valueFormat: lakh,
                dateLabel: (x) => x.slice(0, 4),
              })
            }
          />
          <ul className="sp-milestones" aria-label="Milestones">
            {marks.map((m) => (
              <li key={m.level} data-reached={m.year !== null || undefined}>
                <b>{lakh(m.level).replace('Rs ', '')}</b>
                <small>{m.year !== null ? `${startYear + m.year}` : `not in ${years} yrs`}</small>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="sp-skip">
        Skipping this month’s {lakh(b.budget)} costs about <b>{lakh(skip)}</b> by {startYear + years}.
      </p>

      <div className="sp-assume">
        <button type="button" data-slot="sp-ghost" aria-expanded={tuning} onClick={() => setTuning(!tuning)}>
          <SlidersHorizontal size={14} aria-hidden="true" /> Assumptions
        </button>
        <span className="sp-hint">
          An illustration, not a forecast. Returns are yearly guesses per class; “today’s rupees” takes off about{' '}
          {LONG_RUN_INFLATION.toFixed(1)}% inflation a year (Pakistan’s ten-year average).
        </span>
      </div>
      {tuning && (
        <div className="sp-assume-grid">
          {SIP_CLASSES.map((k) => (
            <label key={k} data-class={k}>
              <span>
                <i aria-hidden="true" />
                {SIP_CLASS_LABELS[k]}
              </span>
              <span className="sp-pct">
                <input
                  inputMode="decimal"
                  value={returns[k]}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/[^0-9.]/g, ''));
                    setReturns({ ...returns, [k]: Number.isFinite(n) ? Math.min(100, n) : 0 });
                  }}
                />
                %/yr
              </span>
            </label>
          ))}
          <div className="sp-assume-actions">
            <button
              type="button"
              className="compact"
              disabled={busy || !changed}
              onClick={() => {
                setError('');
                void onSave({ stepUp, returns }).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save.'));
              }}
            >
              Keep these
            </button>
            <button
              type="button"
              className="secondary compact"
              onClick={() => {
                setReturns({ ...DEFAULT_RETURNS });
                setStepUp(10);
              }}
            >
              Reset
            </button>
          </div>
          {error && <p className="notice error">{error}</p>}
        </div>
      )}
    </section>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const fill = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return (
    <label className="sp-range">
      <span>
        {label} <b className="num">{format(value)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
