// SIP Blueprint: a monthly budget split across asset classes, corrected for drift with fresh money only.
// Pure and self-contained (no imports), so the ledger can validate it without a cycle and the phone can bundle it.
// Everything here runs on the device; the blueprint is stored only inside the encrypted portfolio.

export type SipClass = 'stocks' | 'funds' | 'gold' | 'currency';
export const SIP_CLASSES: SipClass[] = ['stocks', 'funds', 'gold', 'currency'];
export const SIP_CLASS_LABELS: Record<SipClass, string> = {
  stocks: 'PSX stocks',
  funds: 'Funds & savings',
  gold: 'Gold',
  currency: 'Foreign currency',
};

export type SipPresetKey = 'balanced' | 'aggressive' | 'conservative' | 'custom';
export const SIP_PRESETS: Record<
  Exclude<SipPresetKey, 'custom'>,
  { label: string; blurb: string; targets: Record<SipClass, number> }
> = {
  balanced: {
    label: 'Balanced',
    blurb: 'Half in stocks, a third in steady funds, the rest in gold and dollars.',
    targets: { stocks: 50, funds: 30, gold: 15, currency: 5 },
  },
  aggressive: {
    label: 'Growth',
    blurb: 'Mostly stocks. Bigger swings, more growth over the years.',
    targets: { stocks: 70, funds: 20, gold: 10, currency: 0 },
  },
  conservative: {
    label: 'Steady',
    blurb: 'Mostly low-risk funds and savings plans, some dividend stocks, gold as a hedge.',
    targets: { stocks: 20, funds: 60, gold: 20, currency: 0 },
  },
};
export const SIP_PRESET_ORDER: SipPresetKey[] = ['balanced', 'aggressive', 'conservative', 'custom'];
export const SIP_BUDGET_PILLS = [10_000, 25_000, 50_000, 100_000];
/** A month counts toward the streak when at least this share of the budget went in. */
export const STREAK_THRESHOLD = 0.8;
export const MAX_SIP_BUDGET = 1e9;

export type SipDone = { amount: number; date: string };
export type SipMonth = {
  /** The budget and the split this month was planned with, kept so history compares against what was planned. */
  budget: number;
  plan: Record<SipClass, number>;
  /** Classes the person marked done by hand (the ledger is read too, so a logged purchase counts without a tick). */
  done: Partial<Record<SipClass, SipDone>>;
  /** The person moved money between rows by hand this month. */
  edited?: true;
};
export type SipBlueprint = {
  /** Day of the month the person invests (1 to 28). Optional: older blueprints have none and use the 1st. */
  day?: number;
  /** Yearly increase of the monthly amount used in the projection, percent. */
  stepUp?: number;
  /** The person's own expected yearly return per class, percent, for the projection. */
  returns?: Partial<Record<SipClass, number>>;
  budget: number;
  preset: SipPresetKey;
  /** Target share per class in percent; always sums to 100. */
  targets: Record<SipClass, number>;
  /** Keep the static split whatever is held now. */
  strict: boolean;
  /** Remind me when a month is not done (a per-person preference; delivery happens on the device). */
  notify: boolean;
  /** First month this blueprint applied; earlier months are not judged. */
  since: string;
  months: Record<string, SipMonth>;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export const roundTo = (n: number, step: number) => Math.round(n / step) * step;

export function presetTargets(preset: SipPresetKey, custom?: Record<SipClass, number>): Record<SipClass, number> {
  return preset === 'custom' ? { ...(custom ?? SIP_PRESETS.balanced.targets) } : { ...SIP_PRESETS[preset].targets };
}

export function targetsTotal(t: Record<SipClass, number>): number {
  return SIP_CLASSES.reduce((n, k) => n + (t[k] || 0), 0);
}

/** Change one class and take the difference from the other classes in proportion to their size, so the total stays 100. */
export function setTarget(t: Record<SipClass, number>, key: SipClass, value: number): Record<SipClass, number> {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const others = SIP_CLASSES.filter((k) => k !== key);
  const room = 100 - v;
  const otherTotal = others.reduce((n, k) => n + t[k], 0);
  const out = { ...t, [key]: v } as Record<SipClass, number>;
  if (otherTotal <= 0) {
    // Nothing to shrink: spread the room evenly over the other classes, remainder to the first.
    const each = Math.floor(room / others.length);
    others.forEach((k) => (out[k] = each));
    out[others[0]] += room - each * others.length;
    return out;
  }
  let used = 0;
  others.forEach((k) => {
    out[k] = Math.floor((t[k] / otherTotal) * room);
    used += out[k];
  });
  // Hand the rounding remainder to the largest other class.
  const largest = others.reduce((a, b) => (out[b] > out[a] ? b : a), others[0]);
  out[largest] += room - used;
  return out;
}

/**
 * This month's split. Strict returns the static split. Otherwise half of the money follows the target and half goes to
 * classes below their target (in proportion to the gap), so drift closes with fresh money and nothing is ever sold.
 * `weights` are the current shares in percent (0 to 100) of the classes in SIP_CLASSES; null means nothing is held yet,
 * which falls back to the static split. Amounts are rounded to Rs 100 and always add up to the budget.
 */
export function planMonth(
  budget: number,
  targets: Record<SipClass, number>,
  weights: Record<SipClass, number> | null,
  strict: boolean,
): Record<SipClass, number> {
  const total = Math.max(0, Math.round(budget));
  const share: Record<SipClass, number> = { ...targets };
  const tt = targetsTotal(targets) || 100;
  if (!strict && weights) {
    const gap = {} as Record<SipClass, number>;
    let gapTotal = 0;
    for (const k of SIP_CLASSES) {
      gap[k] = targets[k] > 0 ? Math.max(0, targets[k] - weights[k]) : 0;
      gapTotal += gap[k];
    }
    if (gapTotal > 0)
      for (const k of SIP_CLASSES) share[k] = 0.5 * targets[k] + 0.5 * ((gap[k] / gapTotal) * tt);
  }
  const out = {} as Record<SipClass, number>;
  let used = 0;
  for (const k of SIP_CLASSES) {
    out[k] = targets[k] > 0 ? Math.max(0, roundTo((share[k] / tt) * total, 100)) : 0;
    used += out[k];
  }
  // Put the rounding difference on the class with the largest target (never on a class with a zero target).
  const biggest = SIP_CLASSES.reduce((a, b) => (targets[b] > targets[a] ? b : a), SIP_CLASSES[0]);
  out[biggest] = Math.max(0, out[biggest] + (total - used));
  return out;
}

/** Grams of metal that an amount of rupees buys at a 24K rate per gram (null without a rate). */
export function gramsFor(amount: number, pkrPerGram24k: number | null | undefined, karat = 24): number | null {
  if (!pkrPerGram24k || pkrPerGram24k <= 0 || !(amount >= 0)) return null;
  return amount / (pkrPerGram24k * (karat / 24));
}

export type MonthProgress = { planned: number; done: number; percent: number };
/** Total and share completed from the per-class plan and the per-class amount in (each class counts at most its plan). */
export function monthProgress(
  plan: Record<SipClass, number>,
  actual: Partial<Record<SipClass, number>>,
): MonthProgress {
  const planned = SIP_CLASSES.reduce((n, k) => n + plan[k], 0);
  const done = SIP_CLASSES.reduce((n, k) => n + Math.min(plan[k], actual[k] ?? 0), 0);
  return { planned, done, percent: planned > 0 ? Math.round((done / planned) * 100) : 0 };
}

export type MonthRow = { month: string; target: number; actual: number; met: boolean };
export type SipHistory = { rows: MonthRow[]; streak: number; longest: number; thisMonthMet: boolean };

export function monthsBack(asOfMonth: string, count: number): string[] {
  const [y, m] = asOfMonth.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const index = y * 12 + (m - 1) - (count - 1 - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

/**
 * Target against what went in, for the last `count` months. Months before `since` carry no target (target 0) and are
 * not judged. The running month never breaks a streak: until it is met the streak counts up to last month.
 */
export function sipHistory(
  b: Pick<SipBlueprint, 'budget' | 'since' | 'months'>,
  actualByMonth: Record<string, number>,
  asOfMonth: string,
  count = 12,
): SipHistory {
  const rows: MonthRow[] = monthsBack(asOfMonth, count).map((month) => {
    const planned = b.months[month]?.budget ?? (month >= b.since ? b.budget : 0);
    const actual = Math.round(actualByMonth[month] ?? 0);
    return { month, target: planned, actual, met: planned > 0 && actual >= planned * STREAK_THRESHOLD };
  });
  let longest = 0;
  let run = 0;
  for (const r of rows) {
    run = r.met ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const thisMonthMet = rows[rows.length - 1]?.met ?? false;
  let i = rows.length - (thisMonthMet ? 1 : 2);
  let streak = 0;
  while (i >= 0 && rows[i].met) {
    streak += 1;
    i -= 1;
  }
  return { rows, streak, longest, thisMonthMet };
}

export function encouragement(streak: number, thisMonthMet: boolean, percentDone: number): string {
  if (streak >= 12) return `${streak}-month streak. A full year of showing up: that is how wealth is built.`;
  if (streak >= 3) return `Consistency beats timing the market. ${streak}-month streak active!`;
  if (streak >= 1 && thisMonthMet) return `${streak}-month streak and counting. Keep the habit going.`;
  if (streak >= 1) return `${streak}-month streak. Finish this month to keep it alive.`;
  if (thisMonthMet) return 'This month is on track. Do it again next month to start a streak.';
  if (percentDone > 0) return 'Good start. Finish this month to begin your streak.';
  return 'Start small and start now. Even a part of the plan counts toward the habit.';
}

export function blankBlueprint(month: string, budget = SIP_BUDGET_PILLS[1]): SipBlueprint {
  return {
    budget,
    preset: 'balanced',
    targets: presetTargets('balanced'),
    strict: false,
    notify: false,
    since: month,
    months: {},
  };
}

/** Throws a message for the first thing wrong with a blueprint; used by the ledger validator. */
export function validateBlueprint(b: unknown): asserts b is SipBlueprint {
  const bad = (why: string): never => {
    throw new Error(`Invalid SIP blueprint: ${why}.`);
  };
  if (!b || typeof b !== 'object') return bad('not an object');
  const x = b as Partial<SipBlueprint>;
  if (!finite(x.budget) || x.budget < 0 || x.budget > MAX_SIP_BUDGET) bad('budget');
  if (!x.preset || !SIP_PRESET_ORDER.includes(x.preset)) bad('preset');
  if (!x.targets || typeof x.targets !== 'object') return bad('targets');
  let sum = 0;
  for (const k of SIP_CLASSES) {
    const v = x.targets[k];
    if (!finite(v) || v < 0 || v > 100) bad(`target for ${k}`);
    sum += v;
  }
  if (Math.abs(sum - 100) > 0.001) bad('targets must add up to 100');
  if (typeof x.strict !== 'boolean' || typeof x.notify !== 'boolean') bad('switches');
  if (typeof x.since !== 'string' || !MONTH.test(x.since)) bad('start month');
  if (x.day !== undefined && (!Number.isInteger(x.day) || x.day < 1 || x.day > 28)) bad('SIP day');
  if (x.stepUp !== undefined && (!finite(x.stepUp) || x.stepUp < 0 || x.stepUp > 50)) bad('step-up');
  if (x.returns !== undefined) {
    if (!x.returns || typeof x.returns !== 'object') bad('returns');
    for (const [k, v] of Object.entries(x.returns ?? {}))
      if (!SIP_CLASSES.includes(k as SipClass) || !finite(v) || v < -50 || v > 100) bad('return assumption');
  }
  if (!x.months || typeof x.months !== 'object') return bad('months');
  for (const [month, m] of Object.entries(x.months)) {
    if (!MONTH.test(month)) bad('month key');
    if (!finite(m?.budget) || m.budget < 0 || m.budget > MAX_SIP_BUDGET) bad('month budget');
    for (const k of SIP_CLASSES) if (!finite(m.plan?.[k]) || m.plan[k] < 0 || m.plan[k] > MAX_SIP_BUDGET) bad('month plan');
    if (m.edited !== undefined && m.edited !== true) bad('month edited flag');
    for (const [k, d] of Object.entries(m.done ?? {})) {
      if (!SIP_CLASSES.includes(k as SipClass)) bad('done class');
      if (!finite(d?.amount) || d.amount < 0 || d.amount > MAX_SIP_BUDGET || !DATE.test(d.date)) bad('done entry');
    }
  }
}

// ───────────────────────── this month's rows ─────────────────────────

/**
 * Sets one row of this month's plan and moves the difference across the other rows (in proportion to what they hold,
 * or to their targets when they hold nothing), so the plan still adds up to the budget. Rounded to Rs 100.
 */
export function rebalanceEdit(
  plan: Record<SipClass, number>,
  key: SipClass,
  amount: number,
  budget: number,
  targets: Record<SipClass, number>,
  /** Rows that must not move (already done this month). */
  locked: SipClass[] = [],
): Record<SipClass, number> {
  const fixed = locked.filter((k) => k !== key).reduce((n, k) => n + plan[k], 0);
  const total = Math.max(0, Math.round(budget) - fixed);
  const out = { ...plan };
  const others = SIP_CLASSES.filter((k) => k !== key && !locked.includes(k) && (targets[k] > 0 || plan[k] > 0));
  out[key] = others.length ? Math.min(total, Math.max(0, roundTo(amount, 100))) : total;
  for (const k of SIP_CLASSES) if (k !== key && !locked.includes(k) && !others.includes(k)) out[k] = 0;
  if (!others.length) return out;
  const room = total - out[key];
  const held = others.reduce((n, k) => n + plan[k], 0);
  const weigh = (k: SipClass) => (held > 0 ? plan[k] : targets[k] || 1);
  const base = others.reduce((n, k) => n + weigh(k), 0);
  let used = 0;
  for (const k of others) {
    out[k] = Math.max(0, roundTo((weigh(k) / base) * room, 100));
    used += out[k];
  }
  // Rounding remainder: add to the largest row, or take from the largest rows that can give it.
  let diff = room - used;
  const order = [...others].sort((a, b) => out[b] - out[a]);
  for (const k of order) {
    if (!diff) break;
    const next = Math.max(0, out[k] + diff);
    diff -= next - out[k];
    out[k] = next;
  }
  return out;
}

const zeroRow = () => Object.fromEntries(SIP_CLASSES.map((k) => [k, 0])) as Record<SipClass, number>;

/** Shares (0 to 100) of what is held now and after this month's plan is bought. `now` is null when nothing is held. */
export function mixAfter(
  values: Record<SipClass, number>,
  plan: Record<SipClass, number>,
): { now: Record<SipClass, number> | null; after: Record<SipClass, number> } {
  const share = (row: Record<SipClass, number>) => {
    const total = SIP_CLASSES.reduce((n, k) => n + row[k], 0);
    return total > 0
      ? (Object.fromEntries(SIP_CLASSES.map((k) => [k, (row[k] / total) * 100])) as Record<SipClass, number>)
      : null;
  };
  const after = Object.fromEntries(SIP_CLASSES.map((k) => [k, (values[k] ?? 0) + (plan[k] ?? 0)])) as Record<SipClass, number>;
  return { now: share(values), after: share(after) ?? zeroRow() };
}

/** The next SIP day on or after `asOf` and how many days away it is. */
export function nextSipDay(asOf: string, day = 1): { date: string; days: number } {
  const [y, m, d] = asOf.split('-').map(Number);
  const [py, pm] = d <= day ? [y, m] : m === 12 ? [y + 1, 1] : [y, m + 1];
  const date = `${py}-${String(pm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
  return { date, days };
}

export type HabitState = 'met' | 'partial' | 'missed' | 'current' | 'before';
/** One dot per month for the habit strip. The running month is 'current' until it is met. */
export function habitStrip(rows: MonthRow[], asOfMonth: string): { month: string; state: HabitState; row: MonthRow }[] {
  return rows.map((r) => ({
    month: r.month,
    row: r,
    state: r.met
      ? 'met'
      : r.month === asOfMonth
        ? 'current'
        : r.target <= 0
          ? 'before'
          : r.actual > 0
            ? 'partial'
            : 'missed',
  }));
}

// ───────────────────────── future you ─────────────────────────

/** Default expected yearly returns used by the projection, percent. An illustration the person can change. */
export const DEFAULT_RETURNS: Record<SipClass, number> = { stocks: 14, funds: 10, gold: 10, currency: 6 };

/** Yearly return of the whole mix, percent: each class's assumption weighted by its target. */
export function blendedReturn(
  targets: Record<SipClass, number>,
  returns: Partial<Record<SipClass, number>> = {},
): number {
  const tt = targetsTotal(targets) || 100;
  return SIP_CLASSES.reduce((n, k) => n + (targets[k] / tt) * (returns[k] ?? DEFAULT_RETURNS[k]), 0);
}

export type ProjectionPoint = { year: number; invested: number; value: number; realInvested: number; realValue: number };

/** Changes tried on top of the plan in "Future you". Every field is optional; none means the plan as it is. */
export type SipLevers = {
  /** A different monthly amount from now. */
  monthly?: number;
  /** Yearly raise of the monthly amount, percent. */
  stepUp?: number;
  /** Stop putting money in after this many years; what is there keeps growing. */
  stopAfterYears?: number;
  /** Put nothing in for this many years first. */
  startDelayYears?: number;
  /** Put nothing in for `months` months starting at the beginning of `fromYear` (1 is the first year). */
  pause?: { fromYear: number; months: number };
  /** Skip this many months every year (the last ones of the year). */
  skipMonthsPerYear?: number;
  /** Extra money at the start of year `year`, once or every year from then on. */
  extra?: { amount: number; year: number; yearly: boolean };
  /** A different yearly return, percent. */
  annualPct?: number;
  /** A one-time fall of `pct` percent at the start of year `year`. */
  fall?: { pct: number; year: number };
};

export type SipProjectionBase = {
  monthly: number;
  annualPct: number;
  stepUpPct?: number;
  inflationPct?: number;
  /** What the SIP classes are worth today: the projection starts from it and counts it as money in. */
  startValue?: number;
};

/**
 * Money put in at the start of every month, growing at `annualPct` a year (compounded monthly), with the changes in
 * `levers` applied. The monthly amount rises by `stepUpPct` each year, counted from the first year money goes in.
 * `real*` figures are in today's rupees, deflated by `inflationPct`. Year 0 is `startValue` (zero by default).
 */
export function projectScenario(base: SipProjectionBase, levers: SipLevers, years: number): ProjectionPoint[] {
  const annual = levers.annualPct ?? base.annualPct;
  const monthly = Math.max(0, levers.monthly ?? base.monthly);
  const stepUp = levers.stepUp ?? base.stepUpPct ?? 0;
  const delay = Math.max(0, Math.round(levers.startDelayYears ?? 0));
  const r = Math.pow(1 + annual / 100, 1 / 12) - 1;
  const inf = Math.pow(1 + (base.inflationPct ?? 0) / 100, 1 / 12) - 1;
  const start = Math.max(0, base.startValue ?? 0);
  const points: ProjectionPoint[] = [{ year: 0, invested: start, value: start, realInvested: start, realValue: start }];
  let value = start;
  let invested = start;
  let realInvested = start;
  for (let y = 0; y < Math.max(0, Math.round(years)); y++) {
    const active =
      y >= delay && (levers.stopAfterYears === undefined || y < delay + Math.max(0, levers.stopAfterYears));
    const raised = monthly * Math.pow(1 + stepUp / 100, Math.max(0, y - delay));
    if (levers.fall && y === Math.round(levers.fall.year) - 1) value *= 1 - Math.min(100, Math.max(0, levers.fall.pct)) / 100;
    for (let mo = 0; mo < 12; mo++) {
      const m = y * 12 + mo;
      let c = active ? raised : 0;
      const pause = levers.pause;
      if (pause) {
        const from = (Math.round(pause.fromYear) - 1) * 12;
        if (m >= from && m < from + Math.round(pause.months)) c = 0;
      }
      if (levers.skipMonthsPerYear && mo >= 12 - Math.round(levers.skipMonthsPerYear)) c = 0;
      const x = levers.extra;
      if (x && mo === 0 && (x.yearly ? y >= Math.round(x.year) - 1 : y === Math.round(x.year) - 1)) c += Math.max(0, x.amount);
      value = (value + c) * (1 + r);
      invested += c;
      realInvested += c / Math.pow(1 + inf, m);
    }
    points.push({ year: y + 1, invested, value, realInvested, realValue: value / Math.pow(1 + inf, (y + 1) * 12) });
  }
  return points;
}

/** The plan as it is: `projectScenario` with no changes. */
export function projectSip(o: {
  monthly: number;
  years: number;
  annualPct: number;
  stepUpPct?: number;
  inflationPct?: number;
  startValue?: number;
}): ProjectionPoint[] {
  return projectScenario(o, {}, o.years);
}

/** What one month's amount skipped today would have grown to after `years`. */
export function skipCost(monthly: number, years: number, annualPct: number): number {
  return Math.max(0, monthly) * Math.pow(1 + annualPct / 100, Math.max(0, years));
}

/** First year each level is reached, or null when it is not reached within the projection. */
export function milestones(
  points: { year: number; value: number }[],
  levels: number[] = [1e6, 5e6, 1e7],
): { level: number; year: number | null }[] {
  return levels.map((level) => ({ level, year: points.find((p) => p.year > 0 && p.value >= level)?.year ?? null }));
}

/** Rupees the way people say them here: "Rs 12,500", "Rs 4.5 lakh", "Rs 1.2 crore". */
export function lakh(n: number): string {
  const v = Math.round(n);
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  const trim = (x: number, d: number) => String(Number(x.toFixed(d)));
  if (a < 100_000) return `${sign}Rs ${a.toLocaleString('en-US')}`;
  if (a < 10_000_000) return `${sign}Rs ${trim(a / 100_000, a < 1_000_000 ? 2 : 1)} lakh`;
  return `${sign}Rs ${trim(a / 10_000_000, a < 100_000_000 ? 2 : 1)} crore`;
}
