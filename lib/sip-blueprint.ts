// SIP Blueprint: a monthly budget split across asset classes, corrected for drift with fresh money only.
// Pure and self-contained (no imports), so the ledger can validate it without a cycle and the phone can bundle it.
// Everything here runs on the device; the blueprint is stored only inside the encrypted portfolio.

export type SipClass = 'stocks' | 'funds' | 'gold' | 'currency';
export const SIP_CLASSES: SipClass[] = ['stocks', 'funds', 'gold', 'currency'];
export const SIP_CLASS_LABELS: Record<SipClass, string> = {
  stocks: 'PSX stocks',
  funds: 'Funds and savings plans',
  gold: 'Gold',
  currency: 'Foreign currency',
};

export type SipPresetKey = 'balanced' | 'aggressive' | 'conservative' | 'custom';
export const SIP_PRESETS: Record<
  Exclude<SipPresetKey, 'custom'>,
  { label: string; blurb: string; targets: Record<SipClass, number> }
> = {
  balanced: {
    label: 'Balanced Wealth Builder',
    blurb: 'Half in stocks, a third in steady funds, the rest in gold and dollars.',
    targets: { stocks: 50, funds: 30, gold: 15, currency: 5 },
  },
  aggressive: {
    label: 'Aggressive Growth',
    blurb: 'Mostly stocks and equity funds, with some income and gold.',
    targets: { stocks: 70, funds: 20, gold: 10, currency: 0 },
  },
  conservative: {
    label: 'Conservative',
    blurb: 'Protect your capital: mostly low-risk funds and savings plans, a core of dividend stocks, gold as a hedge.',
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
};
export type SipBlueprint = {
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
  if (!x.months || typeof x.months !== 'object') return bad('months');
  for (const [month, m] of Object.entries(x.months)) {
    if (!MONTH.test(month)) bad('month key');
    if (!finite(m?.budget) || m.budget < 0 || m.budget > MAX_SIP_BUDGET) bad('month budget');
    for (const k of SIP_CLASSES) if (!finite(m.plan?.[k]) || m.plan[k] < 0 || m.plan[k] > MAX_SIP_BUDGET) bad('month plan');
    for (const [k, d] of Object.entries(m.done ?? {})) {
      if (!SIP_CLASSES.includes(k as SipClass)) bad('done class');
      if (!finite(d?.amount) || d.amount < 0 || d.amount > MAX_SIP_BUDGET || !DATE.test(d.date)) bad('done entry');
    }
  }
}
