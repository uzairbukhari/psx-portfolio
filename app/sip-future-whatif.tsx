'use client';
// What-ifs for "Future you", loaded on demand: the chip row, the builder, the comparison (chart, takeaway, table) and
// the goal panel. All maths comes from lib/sip-scenarios.ts; nothing here is saved unless the person presses a button.
import { useMemo, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { linesOption } from '@/lib/chart-kit';
import { lakh, projectScenario, type SipLevers, type SipProjectionBase } from '@/lib/sip-blueprint';
import {
  MAX_LOOK_AHEAD,
  MAX_WHAT_IFS,
  compareScenarios,
  goalTakeaway,
  goalWays,
  hasLevers,
  leverLabel,
  scenarioPresets,
  type ScenarioComparison,
} from '@/lib/sip-scenarios';
import { EChart } from './charts/echart';

export type WhatIf = { key: string; levers: SipLevers };

const LINE_VAR = ['--primary', '--cat-3', '--cat-5'];
const dot = (i: number) => ({ background: `var(${LINE_VAR[i] ?? LINE_VAR[0]})` });
const fix = (n: number) => lakh(n).replace(/^(−?)Rs /, '$1');
const change = (n: number) => (Math.abs(n) < 1 ? 'same' : `${n > 0 ? '+' : '−'}${fix(Math.abs(n))}`);
const tone = (n: number) => (Math.abs(n) < 1 ? 'same' : n > 0 ? 'up' : 'down');

export function WhatIfChips({
  base,
  active,
  full,
  goalOpen,
  onPick,
  onBuild,
  onGoal,
}: {
  base: SipProjectionBase;
  /** Labels of the what-ifs already on the chart. */
  active: string[];
  full: boolean;
  goalOpen: boolean;
  onPick: (key: string, levers: SipLevers) => void;
  onBuild: () => void;
  onGoal: () => void;
}) {
  return (
    <div className="sp-whatif">
      <div className="sp-whatif-head">
        <b>What if…</b>
        <span className="sp-hint">
          {full ? `Up to ${MAX_WHAT_IFS} at a time. Remove one to try another.` : 'Try a change and compare it with your plan. Your plan is not changed.'}
        </span>
      </div>
      <div className="sp-chips">
        {scenarioPresets(base).map((p) => (
          <button
            key={p.key}
            type="button"
            data-slot="sp-chip"
            data-on={active.includes(p.label) || undefined}
            disabled={full && !active.includes(p.label)}
            onClick={() => onPick(p.label, p.levers)}
          >
            {p.label}
          </button>
        ))}
        <button type="button" data-slot="sp-chip" data-on={goalOpen || undefined} onClick={onGoal}>
          Reach a goal
        </button>
        <button type="button" data-slot="sp-chip" data-ghost="true" disabled={full} onClick={onBuild}>
          Build your own
        </button>
      </div>
    </div>
  );
}

export function ScenarioCompare({
  base,
  whatIfs,
  years,
  real,
  startYear,
  onEdit,
  onRemove,
}: {
  base: SipProjectionBase;
  whatIfs: WhatIf[];
  years: number;
  real: boolean;
  startYear: number;
  onEdit: (i: number) => void;
  onRemove: (i: number) => void;
}) {
  const cmp: ScenarioComparison = useMemo(
    () => compareScenarios(base, whatIfs, years, { real, startYear }),
    [base, whatIfs, years, real, startYear],
  );
  const [moneyIn, setMoneyIn] = useState(false);
  const cps = cmp.lines[0].summary.checkpoints;
  return (
    <div className="sp-compare">
      <p className="sp-take">{cmp.takeaway}</p>
      <div className="sp-legend">
        {cmp.lines.map((l, i) => (
          <span key={l.key} className="sp-legend-item" data-plan={i === 0 || undefined}>
            <i style={dot(i)} aria-hidden="true" />
            {i > 0 && <b>{'AB'[i - 1]}</b>}
            {l.label}
            {i > 0 && (
              <>
                <button type="button" data-slot="sp-icon" aria-label={`Edit ${l.label}`} onClick={() => onEdit(i - 1)}>
                  ✎
                </button>
                <button type="button" data-slot="sp-icon" aria-label={`Remove ${l.label}`} onClick={() => onRemove(i - 1)}>
                  <X size={12} aria-hidden="true" />
                </button>
              </>
            )}
          </span>
        ))}
        <label className="sp-check">
          <input type="checkbox" checked={moneyIn} onChange={(e) => setMoneyIn(e.target.checked)} /> Show money in
        </label>
      </div>
      <EChart
        className="sp-compare-canvas"
        label={`Your plan against ${cmp.lines.length - 1} what-if${cmp.lines.length > 2 ? 's' : ''} over ${cmp.years} years`}
        build={(t) =>
          linesOption(t, {
            cats: cmp.lines[0].points.map((p) => String(startYear + p.year)),
            series: cmp.lines.map((l, i) => ({
              name: i === 0 ? 'Your plan' : `${'AB'[i - 1]} · ${l.label}`,
              data: l.points.map((p) => Math.round(real ? p.realValue : p.value)),
              color: [t.primary, t.cat[2], t.cat[4]][i] ?? t.primary,
              dash: i === 0,
              inData: moneyIn ? l.points.map((p) => Math.round(real ? p.realInvested : p.invested)) : undefined,
            })),
            valueFormat: lakh,
          })
        }
      />
      <div className="sp-table-wrap">
        <table className="sp-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Measure</span>
              </th>
              {cmp.lines.map((l, i) => (
                <th key={l.key} scope="col">
                  <i style={dot(i)} aria-hidden="true" />
                  {i === 0 ? 'Your plan' : l.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cps.map((c, k) => (
              <tr key={c.year} data-end={k === cps.length - 1 || undefined}>
                <th scope="row">
                  In {c.year} year{c.year === 1 ? '' : 's'} ({startYear + c.year})
                </th>
                {cmp.lines.map((l, i) => (
                  <td key={l.key} className="num">
                    {fix(l.summary.checkpoints[k].value)}
                    {i > 0 && (
                      <small data-tone={tone(l.summary.checkpoints[k].value - cps[k].value)}>
                        {change(l.summary.checkpoints[k].value - cps[k].value)}
                      </small>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">You put in</th>
              {cmp.lines.map((l) => (
                <td key={l.key} className="num">
                  {fix(l.summary.invested)}
                  {l.delta && <small data-tone={tone(l.delta.invested)}>{change(l.delta.invested)}</small>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Growth</th>
              {cmp.lines.map((l) => (
                <td key={l.key} className="num">
                  {fix(l.summary.growth)}
                  {l.delta && <small data-tone={tone(l.delta.growth)}>{change(l.delta.growth)}</small>}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Each rupee became</th>
              {cmp.lines.map((l) => (
                <td key={l.key} className="num">
                  {l.summary.multiple === null ? '–' : `Rs ${l.summary.multiple.toFixed(1)}`}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Rs 1 crore reached</th>
              {cmp.lines.map((l) => (
                <td key={l.key} className="num">
                  {l.summary.yearReached === null ? <span className="sp-hint">not by {startYear + cmp.years}</span> : startYear + l.summary.yearReached}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  format,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (n: number) => string;
  label: string;
  onChange: (n: number) => void;
}) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, Math.round(n * 100) / 100)));
  return (
    <span className="sp-step">
      <button type="button" data-slot="sp-icon" aria-label={`Less ${label}`} onClick={() => set(value - step)}>
        <Minus size={14} aria-hidden="true" />
      </button>
      <b className="num">{format ? format(value) : value}</b>
      <button type="button" data-slot="sp-icon" aria-label={`More ${label}`} onClick={() => set(value + step)}>
        <Plus size={14} aria-hidden="true" />
      </button>
    </span>
  );
}

function Lever({
  title,
  hint,
  on,
  onToggle,
  children,
}: {
  title: string;
  hint?: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="sp-lever" data-on={on || undefined}>
      <label>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        <span>
          {title}
          {hint && <small>{hint}</small>}
        </span>
      </label>
      {on && <div className="sp-lever-body">{children}</div>}
    </div>
  );
}

const pct = (n: number) => `${n}%`;
const yrs = (n: number) => `${n} yr${n === 1 ? '' : 's'}`;
const mos = (n: number) => `${n} mo`;

/** Every change a what-if can make, each behind a switch with its own stepper. */
export function ScenarioBuilder({
  base,
  value,
  years,
  onChange,
  onDone,
  onCancel,
}: {
  base: SipProjectionBase;
  value: SipLevers;
  years: number;
  onChange: (l: SipLevers) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const set = (patch: Partial<SipLevers>) => {
    const next = { ...value, ...patch };
    for (const k of Object.keys(next) as (keyof SipLevers)[]) if (next[k] === undefined) delete next[k];
    onChange(next);
  };
  const end = useMemo(() => {
    const p = projectScenario(base, value, years);
    const plan = projectScenario(base, {}, years);
    return { value: p[years].value, invested: p[years].invested, planValue: plan[years].value, planInvested: plan[years].invested };
  }, [base, value, years]);
  const x = value.extra;
  return (
    <div className="sp-builder">
      <p className="sp-hint">Every change starts from your plan. Turn on as many as you like; the numbers update as you go.</p>
      <Lever title="Invest for a while, then stop" hint="What is there keeps growing" on={value.stopAfterYears !== undefined} onToggle={(o) => set({ stopAfterYears: o ? 3 : undefined })}>
        <Stepper label="years" value={value.stopAfterYears ?? 3} min={1} max={30} format={yrs} onChange={(n) => set({ stopAfterYears: n })} />
      </Lever>
      <Lever title="Raise it every year" hint={`Your plan: ${base.stepUpPct ?? 0}%`} on={value.stepUp !== undefined} onToggle={(o) => set({ stepUp: o ? Math.max(10, (base.stepUpPct ?? 0) + 5) : undefined })}>
        <Stepper label="raise" value={value.stepUp ?? 10} min={0} max={30} format={pct} onChange={(n) => set({ stepUp: n })} />
      </Lever>
      <Lever title="A different monthly amount" hint={`Your plan: ${lakh(base.monthly)}`} on={value.monthly !== undefined} onToggle={(o) => set({ monthly: o ? base.monthly : undefined })}>
        <Stepper label="amount" value={value.monthly ?? base.monthly} min={5_000} max={1_000_000} step={5_000} format={lakh} onChange={(n) => set({ monthly: n })} />
      </Lever>
      <Lever title="Start later" on={!!value.startDelayYears} onToggle={(o) => set({ startDelayYears: o ? 2 : undefined })}>
        <Stepper label="years" value={value.startDelayYears ?? 2} min={1} max={10} format={yrs} onChange={(n) => set({ startDelayYears: n })} />
      </Lever>
      <Lever title="Take a break" hint="A job change or a big expense" on={!!value.pause} onToggle={(o) => set({ pause: o ? { fromYear: 2, months: 6 } : undefined })}>
        <Stepper label="months off" value={value.pause?.months ?? 6} min={1} max={24} format={mos} onChange={(n) => set({ pause: { fromYear: value.pause?.fromYear ?? 2, months: n } })} />
        <span className="sp-hint">from year</span>
        <Stepper label="start year" value={value.pause?.fromYear ?? 2} min={1} max={years} onChange={(n) => set({ pause: { months: value.pause?.months ?? 6, fromYear: n } })} />
      </Lever>
      <Lever title="Skip some months each year" hint="Eid, school fees, insurance" on={!!value.skipMonthsPerYear} onToggle={(o) => set({ skipMonthsPerYear: o ? 2 : undefined })}>
        <Stepper label="months" value={value.skipMonthsPerYear ?? 2} min={1} max={6} format={mos} onChange={(n) => set({ skipMonthsPerYear: n })} />
      </Lever>
      <Lever title="Extra money" hint="A bonus, an inheritance, a sale" on={!!x} onToggle={(o) => set({ extra: o ? { amount: 100_000, year: 1, yearly: true } : undefined })}>
        <Stepper label="extra amount" value={x?.amount ?? 100_000} min={10_000} max={100_000_000} step={25_000} format={lakh} onChange={(n) => set({ extra: { year: x?.year ?? 1, yearly: x?.yearly ?? true, amount: n } })} />
        <label className="sp-check">
          <input type="checkbox" checked={x?.yearly ?? true} onChange={(e) => set({ extra: { amount: x?.amount ?? 100_000, year: x?.year ?? 1, yearly: e.target.checked } })} /> every year
        </label>
        <span className="sp-hint">from year</span>
        <Stepper label="year" value={x?.year ?? 1} min={1} max={years} onChange={(n) => set({ extra: { amount: x?.amount ?? 100_000, yearly: x?.yearly ?? true, year: n } })} />
      </Lever>
      <Lever title="A different yearly return" hint={`Your mix: ${base.annualPct.toFixed(1)}%`} on={value.annualPct !== undefined} onToggle={(o) => set({ annualPct: o ? Math.max(0, Math.round(base.annualPct - 3)) : undefined })}>
        <Stepper label="return" value={value.annualPct ?? base.annualPct} min={0} max={40} format={pct} onChange={(n) => set({ annualPct: n })} />
      </Lever>
      <Lever title="A market fall" hint="One drop, then it carries on" on={!!value.fall} onToggle={(o) => set({ fall: o ? { pct: 30, year: 5 } : undefined })}>
        <Stepper label="fall" value={value.fall?.pct ?? 30} min={5} max={80} step={5} format={pct} onChange={(n) => set({ fall: { year: value.fall?.year ?? 5, pct: n } })} />
        <span className="sp-hint">in year</span>
        <Stepper label="year" value={value.fall?.year ?? 5} min={1} max={years} onChange={(n) => set({ fall: { pct: value.fall?.pct ?? 30, year: n } })} />
      </Lever>
      <div className="sp-builder-foot">
        <span className="sp-hint">
          In {years} years: <b className="num">{lakh(end.value)}</b> (<span data-tone={tone(end.value - end.planValue)}>{change(end.value - end.planValue)}</span>), you put in{' '}
          <b className="num">{lakh(end.invested)}</b>
        </span>
        <div className="sp-assume-actions">
          <button type="button" className="secondary compact" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="compact" disabled={!hasLevers(value)} onClick={onDone}>
            Compare
          </button>
        </div>
      </div>
      {hasLevers(value) && <p className="sp-hint">{leverLabel(value)}</p>}
    </div>
  );
}

/** "I want Rs X [by year Y]": the year the plan gets there, and the ways to close a gap before a deadline. */
export function GoalPanel({
  base,
  startYear,
  onUseMonthly,
  onKeepStepUp,
  busy,
}: {
  base: SipProjectionBase;
  startYear: number;
  onUseMonthly: (n: number) => void;
  onKeepStepUp: (n: number) => void;
  busy: boolean;
}) {
  const [amount, setAmount] = useState('6');
  const [unit, setUnit] = useState<'lakh' | 'crore'>('crore');
  const [by, setBy] = useState('');
  const target = (Number(amount.replace(/[^0-9.]/g, '')) || 0) * (unit === 'crore' ? 1e7 : 1e5);
  const deadline = by ? Number(by) - startYear : undefined;
  const validDeadline = deadline !== undefined && Number.isFinite(deadline) && deadline >= 1 && deadline <= 50 ? deadline : undefined;
  const g = useMemo(() => (target > 0 ? goalWays(base, target, validDeadline) : null), [base, target, validDeadline]);
  const horizon = Math.min(MAX_LOOK_AHEAD + 10, Math.max(5, (validDeadline ?? g?.yearsToReach ?? 20) + 1));
  const lines = useMemo(() => {
    if (!g) return null;
    const out = [{ name: 'Your plan', points: projectScenario(base, {}, horizon), dash: true }];
    if (g.monthlyNeeded && g.monthlyNeeded > 0 && !g.onTrack)
      out.push({ name: `${lakh(g.monthlyNeeded)} a month`, points: projectScenario(base, { monthly: g.monthlyNeeded }, horizon), dash: false });
    if (g.stepUpNeeded !== null && g.stepUpNeeded !== undefined && !g.onTrack)
      out.push({ name: `Raise ${g.stepUpNeeded}% a year`, points: projectScenario(base, { stepUp: g.stepUpNeeded }, horizon), dash: false });
    return out;
  }, [g, base, horizon]);
  return (
    <div className="sp-goal">
      <div className="sp-goal-form">
        <span>I want</span>
        <span className="sp-money-in">
          Rs
          <input aria-label="Goal amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as 'lakh' | 'crore')}>
            <option value="lakh">lakh</option>
            <option value="crore">crore</option>
          </select>
        </span>
        <span>by</span>
        <input className="sp-year-in" aria-label="Goal year (optional)" inputMode="numeric" placeholder="year (optional)" value={by} onChange={(e) => setBy(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      </div>
      {g && <p className="sp-take">{goalTakeaway(g, startYear)}</p>}
      {g && g.deadlineYears !== undefined && !g.onTrack && (
        <div className="sp-ways">
          <div data-best>
            <small>Put in more each month</small>
            <b className="num">{g.monthlyNeeded === null || g.monthlyNeeded === undefined ? 'Not enough' : lakh(g.monthlyNeeded)}</b>
            {g.monthlyNeeded ? <small>{lakh(Math.max(0, g.monthlyNeeded - base.monthly))} more than now</small> : null}
            {g.monthlyNeeded ? (
              <button type="button" className="secondary compact" onClick={() => onUseMonthly(g.monthlyNeeded as number)}>
                Try it above
              </button>
            ) : null}
          </div>
          <div>
            <small>Keep {lakh(base.monthly)}, raise it yearly by</small>
            <b className="num">{g.stepUpNeeded === null || g.stepUpNeeded === undefined ? 'More than 30%' : `${g.stepUpNeeded}%`}</b>
            {g.stepUpNeeded ? (
              <button type="button" className="secondary compact" disabled={busy} onClick={() => onKeepStepUp(g.stepUpNeeded as number)}>
                Keep it in my plan
              </button>
            ) : null}
          </div>
          <div>
            <small>Change nothing, you get there in</small>
            <b className="num">{g.yearsToReach === null ? 'Not in 50 years' : startYear + g.yearsToReach}</b>
            {g.yearsToReach !== null && g.deadlineYears !== undefined ? <small>{g.yearsToReach - g.deadlineYears} year{g.yearsToReach - g.deadlineYears === 1 ? '' : 's'} later than you wanted</small> : null}
          </div>
        </div>
      )}
      {lines && g && lines.length > 1 && (
        <div className="sp-legend">
          {lines.map((l, i) => (
            <span key={l.name} className="sp-legend-item" data-plan="true">
              <i style={dot(i)} aria-hidden="true" />
              {l.name}
            </span>
          ))}
        </div>
      )}
      {lines && g && (
        <EChart
          className="sp-compare-canvas"
          label="Your plan against the goal"
          build={(t) =>
            linesOption(t, {
              cats: lines[0].points.map((p) => String(startYear + p.year)),
              series: lines.map((l, i) => ({
                name: l.name,
                data: l.points.map((p) => Math.round(p.value)),
                color: [t.primary, t.cat[2], t.cat[4]][i] ?? t.primary,
                dash: l.dash,
              })),
              valueFormat: lakh,
              refLine: { y: g.target, label: `Goal ${lakh(g.target)}` },
            })
          }
        />
      )}
    </div>
  );
}
