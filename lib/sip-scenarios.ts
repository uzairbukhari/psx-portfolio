// What-ifs for "Future you": the plan plus a few changes, compared side by side, and the reverse question (a goal).
// Pure and self-contained apart from sip-blueprint (shared with the phone and the Android engine); no clock, no I/O.
import { lakh, projectScenario, type ProjectionPoint, type SipLevers, type SipProjectionBase } from './sip-blueprint.ts';

export const MAX_LOOK_AHEAD = 40;
export const MAX_WHAT_IFS = 2;

export type ScenarioKind = 'stop' | 'raise' | 'later' | 'break' | 'skip' | 'extra' | 'returns' | 'fall' | 'goal' | 'custom';

export type ScenarioPreset = { key: ScenarioKind; label: string; levers: SipLevers };

/** Whether any change is set (an empty what-if is the plan itself). */
export function hasLevers(l: SipLevers): boolean {
  return Object.values(l).some((v) => v !== undefined);
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The kind a lever set belongs to for analytics: one change keeps its name, several are `custom`. */
export function leverKind(l: SipLevers): ScenarioKind {
  const keys = (Object.keys(l) as (keyof SipLevers)[]).filter((k) => l[k] !== undefined);
  if (keys.length !== 1) return 'custom';
  const map: Partial<Record<keyof SipLevers, ScenarioKind>> = {
    stopAfterYears: 'stop',
    stepUp: 'raise',
    startDelayYears: 'later',
    pause: 'break',
    skipMonthsPerYear: 'skip',
    extra: 'extra',
    annualPct: 'returns',
    fall: 'fall',
  };
  return map[keys[0]] ?? 'custom';
}

/** A short name for a what-if, built from its changes ("Stop after 3 years + Raise 10% a year"). */
export function leverLabel(l: SipLevers): string {
  const parts: string[] = [];
  if (l.monthly !== undefined) parts.push(`${lakh(l.monthly)} a month`);
  if (l.stopAfterYears !== undefined) parts.push(`Stop after ${plural(l.stopAfterYears, 'year')}`);
  if (l.stepUp !== undefined) parts.push(`Raise ${l.stepUp}% a year`);
  if (l.startDelayYears) parts.push(`Start ${plural(l.startDelayYears, 'year')} later`);
  if (l.pause) parts.push(`${plural(l.pause.months, 'month')} break in year ${l.pause.fromYear}`);
  if (l.skipMonthsPerYear) parts.push(`Skip ${plural(l.skipMonthsPerYear, 'month')} a year`);
  if (l.extra) parts.push(`Add ${lakh(l.extra.amount)} ${l.extra.yearly ? 'each year' : `in year ${l.extra.year}`}`);
  if (l.annualPct !== undefined) parts.push(`${l.annualPct}% a year return`);
  if (l.fall) parts.push(`${l.fall.pct}% fall in year ${l.fall.year}`);
  return parts.join(' + ') || 'Your plan';
}

/** The one-tap what-ifs, sized from the person's own plan. `goal` is not a lever set; the UI opens the goal panel. */
export function scenarioPresets(base: SipProjectionBase): ScenarioPreset[] {
  const step = base.stepUpPct ?? 0;
  const raise = step >= 10 ? step + 5 : 10;
  const extra = Math.max(10_000, Math.round((base.monthly * 2) / 25_000) * 25_000);
  const slower = Math.max(0, Math.round((base.annualPct - 3) * 10) / 10);
  return [
    { key: 'stop', label: 'Stop after 3 years', levers: { stopAfterYears: 3 } },
    { key: 'raise', label: `Raise ${raise}% a year`, levers: { stepUp: raise } },
    { key: 'later', label: 'Start 2 years later', levers: { startDelayYears: 2 } },
    { key: 'break', label: 'Take a 6-month break', levers: { pause: { fromYear: 2, months: 6 } } },
    { key: 'extra', label: `Add ${lakh(extra)} each year`, levers: { extra: { amount: extra, year: 1, yearly: true } } },
    { key: 'returns', label: 'Slower markets', levers: { annualPct: slower } },
    { key: 'fall', label: 'A 30% fall in year 5', levers: { fall: { pct: 30, year: 5 } } },
  ];
}

export type LineSummary = {
  value: number;
  invested: number;
  growth: number;
  /** What each rupee put in became; null when nothing went in. */
  multiple: number | null;
  /** Years until this much is first reached (null when not within the look-ahead). */
  yearReached: number | null;
  checkpoints: { year: number; value: number }[];
};

/** The years worth reading values at: 5, 10, 20 and 30 that fall inside the look-ahead, and the end. */
export function checkpointYears(years: number): number[] {
  const out = [5, 10, 20, 30].filter((y) => y < years);
  if (years > 0) out.push(years);
  return out;
}

export function summarizeLine(points: ProjectionPoint[], years: number, real: boolean, level = 1e7): LineSummary {
  const at = (y: number) => points[Math.min(points.length - 1, Math.max(0, y))];
  const val = (p: ProjectionPoint) => (real ? p.realValue : p.value);
  const inv = (p: ProjectionPoint) => (real ? p.realInvested : p.invested);
  const end = at(years);
  const reached = points.find((p) => p.year > 0 && val(p) >= level);
  return {
    value: val(end),
    invested: inv(end),
    growth: Math.max(0, val(end) - inv(end)),
    multiple: inv(end) > 0 ? val(end) / inv(end) : null,
    yearReached: reached ? reached.year : null,
    checkpoints: checkpointYears(years).map((y) => ({ year: y, value: val(at(y)) })),
  };
}

export type ScenarioLine = {
  key: string;
  label: string;
  levers: SipLevers;
  points: ProjectionPoint[];
  summary: LineSummary;
  /** Change against the plan (what-if minus plan); null for the plan itself. */
  delta: { value: number; invested: number; growth: number } | null;
};

export type ScenarioComparison = { lines: ScenarioLine[]; years: number; takeaway: string };

/** The plan and up to two what-ifs over the same look-ahead, with changes against the plan and a headline. */
export function compareScenarios(
  base: SipProjectionBase,
  whatIfs: { key: string; levers: SipLevers; label?: string }[],
  years: number,
  opts: { real?: boolean; startYear: number },
): ScenarioComparison {
  const real = !!opts.real;
  const horizon = Math.min(MAX_LOOK_AHEAD, Math.max(1, Math.round(years)));
  const make = (key: string, label: string, levers: SipLevers): ScenarioLine => {
    const points = projectScenario(base, levers, horizon);
    return { key, label, levers, points, summary: summarizeLine(points, horizon, real), delta: null };
  };
  const plan = make('plan', 'Your plan', {});
  const rest = whatIfs.slice(0, MAX_WHAT_IFS).map((w) => {
    const line = make(w.key, w.label ?? leverLabel(w.levers), w.levers);
    line.delta = {
      value: line.summary.value - plan.summary.value,
      invested: line.summary.invested - plan.summary.invested,
      growth: line.summary.growth - plan.summary.growth,
    };
    return line;
  });
  return { lines: [plan, ...rest], years: horizon, takeaway: takeaway(plan, rest, horizon, opts.startYear) };
}

const nice = (n: number) => lakh(Math.abs(n));

/** One sentence that says what the change does, in plain words; combined changes fall back to a general form. */
export function takeaway(plan: ScenarioLine, whatIfs: ScenarioLine[], years: number, startYear: number): string {
  const first = whatIfs[0];
  if (!first) return `Your plan reaches ${lakh(plan.summary.value)} by ${startYear + years}.`;
  const end = startYear + years;
  const diff = first.summary.value - plan.summary.value;
  const l = first.levers;
  const kind = leverKind(l);
  let head: string;
  if (kind === 'stop') {
    head = `Stopping after ${plural(l.stopAfterYears ?? 0, 'year')} still grows to ${lakh(first.summary.value)} by ${end}: ${nice(diff)} ${diff < 0 ? 'less' : 'more'} than keeping going, from ${lakh(first.summary.invested)} put in.`;
  } else if (kind === 'raise' && plan.summary.value > 0) {
    const ratio = first.summary.value / plan.summary.value;
    head = `Raising it ${l.stepUp}% a year ends at ${lakh(first.summary.value)} by ${end}, ${ratio >= 1.8 ? `about ${ratio.toFixed(1)} times your plan` : `${nice(diff)} ${diff < 0 ? 'less' : 'more'} than your plan`}.`;
  } else {
    head = `${first.label} ends at ${lakh(first.summary.value)} by ${end}, ${nice(diff)} ${diff < 0 ? 'less' : 'more'} than your plan.`;
  }
  const second = whatIfs[1];
  if (!second) return head;
  const d2 = second.summary.value - plan.summary.value;
  return `${head} ${second.label} ends at ${lakh(second.summary.value)}, ${nice(d2)} ${d2 < 0 ? 'less' : 'more'} than your plan.`;
}

export type GoalWays = {
  target: number;
  /** Years from now to the goal on the plan as it is (null when not within 50 years). */
  yearsToReach: number | null;
  /** With a deadline: what the plan is worth then, the shortfall, and the ways to close it. */
  deadlineYears?: number;
  planValue?: number;
  shortfall?: number;
  onTrack?: boolean;
  /** Monthly amount needed from now, rounded up to Rs 500 (0 when what is held already gets there). */
  monthlyNeeded?: number | null;
  /** Yearly raise needed with today's monthly amount, percent to one decimal; null if even 30% is not enough. */
  stepUpNeeded?: number | null;
};

const GOAL_SEARCH_YEARS = 50;

/**
 * How long a goal takes on the plan, and, given a deadline in years, how much more a month or what yearly raise gets there.
 * The value is linear in the monthly amount, so the amount needed is one division; the raise is found by bisection.
 */
export function goalWays(base: SipProjectionBase, target: number, deadlineYears?: number): GoalWays {
  const goal = Math.max(0, target);
  const long = projectScenario(base, {}, GOAL_SEARCH_YEARS);
  const reached = long.find((p) => p.year > 0 && p.value >= goal);
  const out: GoalWays = { target: goal, yearsToReach: reached ? reached.year : null };
  if (!deadlineYears || deadlineYears < 1) return out;
  const years = Math.min(GOAL_SEARCH_YEARS, Math.round(deadlineYears));
  const end = (l: SipLevers, b: SipProjectionBase = base) => projectScenario(b, l, years)[years].value;
  const planValue = end({});
  out.deadlineYears = years;
  out.planValue = planValue;
  out.shortfall = Math.max(0, goal - planValue);
  out.onTrack = planValue >= goal;
  const held = end({ monthly: 0 });
  const perRupee = end({ monthly: 1 }) - held;
  out.monthlyNeeded = held >= goal ? 0 : perRupee > 0 ? Math.ceil((goal - held) / perRupee / 500) * 500 : null;
  if (planValue >= goal) {
    out.stepUpNeeded = base.stepUpPct ?? 0;
  } else if (end({ stepUp: 30 }) < goal) {
    out.stepUpNeeded = null;
  } else {
    let lo = base.stepUpPct ?? 0;
    let hi = 30;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (end({ stepUp: mid }) >= goal) hi = mid;
      else lo = mid;
    }
    out.stepUpNeeded = Math.ceil(hi * 10) / 10;
  }
  return out;
}

/** The sentence under a goal: where the plan lands and the gap, or the year it gets there. */
export function goalTakeaway(g: GoalWays, startYear: number): string {
  const when =
    g.yearsToReach === null
      ? `not within ${GOAL_SEARCH_YEARS} years`
      : `in ${plural(g.yearsToReach, 'year')} (${startYear + g.yearsToReach})`;
  if (g.deadlineYears === undefined) return `On your plan you reach ${lakh(g.target)} ${when}.`;
  if (g.onTrack) return `Your plan reaches ${lakh(g.target)} ${when}, in time for ${startYear + g.deadlineYears}.`;
  return `Your plan reaches ${lakh(g.planValue ?? 0)} by ${startYear + g.deadlineYears}, ${lakh(g.shortfall ?? 0)} short. It gets to ${lakh(g.target)} ${when}.`;
}
