// Reads the decrypted ledger for the SIP Blueprint: current class weights, money in per month and class, and the
// one-click "log it" entries. Pure: no React, no I/O, no clock. Kept apart from `sip-blueprint.ts` so the ledger
// validator can import that file without a cycle.
import { accountOverview } from './account-overview.ts';
import { newAssetId, valueAsset, type Asset, type MetalAsset, type MetalEntry } from './assets.ts';
import type { CurrencyAsset, CurrencyEntry } from './currency.ts';
import type { CurrencyCode, FxRateRow } from './fx-rates.ts';
import { TOLA_GRAMS, chooseRate, type MetalRateRow } from './metal-rates.ts';
import type { FundNavRow } from './mufap.ts';
import { moneyInFlows } from './performance.ts';
import type { PlanNavRow } from './plans.ts';
import { CURRENCY_NAMES, chooseFxRate } from './fx-rates.ts';
import type { DisplayPart, Portfolio } from './portfolio.ts';
import { CPI_YOY_BY_YEAR } from './pk-benchmarks.ts';
import {
  SIP_CLASSES,
  SIP_CLASS_LABELS,
  STREAK_THRESHOLD,
  encouragement,
  gramsFor,
  habitStrip,
  lakh,
  mixAfter,
  monthProgress,
  nextSipDay,
  planMonth,
  roundTo,
  sipHistory,
  type MonthProgress,
  type SipBlueprint,
  type SipClass,
  type SipHistory,
  type SipMonth,
} from './sip-blueprint.ts';

export type SipRates = {
  metalRates?: MetalRateRow[];
  fundNavs?: FundNavRow[];
  planNavs?: PlanNavRow[];
  fxRates?: FxRateRow[];
};

const sipClassOf = (key: string): SipClass | null =>
  key === 'plans' ? 'funds' : (SIP_CLASSES as string[]).includes(key) ? (key as SipClass) : null;

/** What is held now, per blueprint class (savings plans count with funds). `weights` is null when nothing is held. */
export function classWeights(
  parts: (DisplayPart & { locked?: boolean })[],
  asOf: string,
  rates: SipRates = {},
): { weights: Record<SipClass, number> | null; values: Record<SipClass, number>; total: number } {
  const overview = accountOverview(parts, asOf, rates);
  const values = Object.fromEntries(SIP_CLASSES.map((k) => [k, 0])) as Record<SipClass, number>;
  for (const c of overview.classes) {
    const k = sipClassOf(c.key);
    if (k) values[k] += c.value;
  }
  const total = SIP_CLASSES.reduce((n, k) => n + values[k], 0);
  const weights = total > 0 ? (Object.fromEntries(SIP_CLASSES.map((k) => [k, (values[k] / total) * 100])) as Record<SipClass, number>) : null;
  return { weights, values, total };
}

/** Money that went in per month, per class (purchases only, sales and redemptions are not subtracted). */
export function moneyInByMonth(
  parts: DisplayPart[],
  asOf: string,
  rates: SipRates = {},
): Record<string, Partial<Record<SipClass, number>>> {
  const out: Record<string, Partial<Record<SipClass, number>>> = {};
  const add = (date: string, k: SipClass, amount: number) => {
    if (date > asOf || !(amount > 0)) return;
    const row = (out[date.slice(0, 7)] ??= {});
    row[k] = (row[k] ?? 0) + amount;
  };
  for (const part of parts) {
    for (const f of moneyInFlows(part.portfolio).flows) add(f.date, 'stocks', f.amount);
    for (const asset of part.portfolio.assets ?? []) {
      const v = valueAsset(asset, rates.metalRates ?? [], asOf, rates.fundNavs ?? [], rates.planNavs ?? [], rates.fxRates ?? []);
      const k = sipClassOf(v.classKey);
      if (!k) continue;
      for (const f of v.flows) add(f.date, k, f.amount);
    }
  }
  return out;
}

/**
 * Shares held at the start of the month: today's value minus what went in this month, per class. Using this for the
 * drift plan keeps the plan steady while the month's purchases are being logged. Null when nothing was held.
 */
export function startOfMonthWeights(
  values: Record<SipClass, number>,
  thisMonthIn: Partial<Record<SipClass, number>> = {},
): Record<SipClass, number> | null {
  const before = Object.fromEntries(
    SIP_CLASSES.map((k) => [k, Math.max(0, (values[k] ?? 0) - (thisMonthIn[k] ?? 0))]),
  ) as Record<SipClass, number>;
  const total = SIP_CLASSES.reduce((n, k) => n + before[k], 0);
  if (!(total > 0)) return null;
  return Object.fromEntries(SIP_CLASSES.map((k) => [k, (before[k] / total) * 100])) as Record<SipClass, number>;
}

/** What went in per month and class: the ledger, or the amount ticked by hand when that is larger (never added twice). */
export function mergeActual(
  ledger: Record<string, Partial<Record<SipClass, number>>>,
  months: Record<string, SipMonth>,
): Record<string, Partial<Record<SipClass, number>>> {
  const out: Record<string, Partial<Record<SipClass, number>>> = {};
  for (const [m, row] of Object.entries(ledger)) out[m] = { ...row };
  for (const [m, snap] of Object.entries(months)) {
    const row = (out[m] ??= {});
    for (const k of SIP_CLASSES) {
      const manual = snap.done[k]?.amount;
      if (manual !== undefined) row[k] = Math.max(row[k] ?? 0, manual);
    }
  }
  return out;
}

/** Total money in per month (for the history chart and the streak). */
export function totalsByMonth(byClass: Record<string, Partial<Record<SipClass, number>>>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(byClass).map(([m, row]) => [m, SIP_CLASSES.reduce((n, k) => n + (row[k] ?? 0), 0)]),
  );
}

export type QuickEntry =
  | { class: 'gold'; date: string; grams: number; amount: number }
  | { class: 'currency'; date: string; currency: CurrencyCode; units: number; pkr: number };

const LOG_NOTE = 'Logged from SIP Blueprint';

/** Returns the portfolio with a purchase added: into the matching holding when there is one, else into a new holding. */
export function withQuickEntry(portfolio: Portfolio, e: QuickEntry): Portfolio {
  const assets: Asset[] = [...(portfolio.assets ?? [])];
  if (e.class === 'currency') {
    const entry: CurrencyEntry = { id: newAssetId(), date: e.date, type: 'buy', units: e.units, pkr: e.pkr, note: LOG_NOTE };
    const at = assets.findIndex((a) => a.kind === 'currency' && a.currency === e.currency);
    if (at >= 0) {
      const a = assets[at] as CurrencyAsset;
      assets[at] = { ...a, entries: [...a.entries, entry] };
    } else
      assets.push({
        id: newAssetId(),
        kind: 'currency',
        name: `${CURRENCY_NAMES[e.currency]} (cash)`,
        currency: e.currency,
        heldAt: 'cash',
        note: '',
        entries: [entry],
      });
    return { ...portfolio, assets };
  }
  const entry: MetalEntry = { id: newAssetId(), date: e.date, type: 'buy', grams: e.grams, amount: e.amount, note: LOG_NOTE };
  const at = assets.findIndex((a) => a.kind === 'metal' && a.metal === 'gold' && a.karat === 24);
  if (at >= 0) {
    const a = assets[at] as MetalAsset;
    assets[at] = { ...a, entries: [...a.entries, entry] };
  } else
    assets.push({
      id: newAssetId(),
      kind: 'metal',
      name: 'Gold 24K',
      metal: 'gold',
      karat: 24,
      note: '',
      entries: [entry],
    });
  return { ...portfolio, assets };
}

/** Long-run inflation for "today's rupees": the average of the last ten calendar years in the public CPI table. */
export const LONG_RUN_INFLATION = (() => {
  const last = CPI_YOY_BY_YEAR.slice(-10);
  return last.length ? last.reduce((n, [, v]) => n + v, 0) / last.length : 8;
})();

export type SipMonthState = {
  month: string;
  budget: number;
  plan: Record<SipClass, number>;
  /** Plan before any hand edits this month (what the blueprint alone suggests). */
  suggested: Record<SipClass, number>;
  /** What went in this month per class (ledger, or a larger hand tick). */
  actual: Partial<Record<SipClass, number>>;
  done: Record<SipClass, boolean>;
  progress: MonthProgress;
  history: SipHistory;
  strip: ReturnType<typeof habitStrip>;
  values: Record<SipClass, number>;
  weights: Record<SipClass, number> | null;
  mix: ReturnType<typeof mixAfter>;
  /** This calendar year: money put in and months that met the target. */
  year: { invested: number; monthsMet: number };
};

/** Everything the page shows for the running month, worked out once. */
export function sipMonthState(
  b: SipBlueprint,
  parts: (DisplayPart & { locked?: boolean })[],
  asOf: string,
  rates: SipRates = {},
): SipMonthState {
  const month = asOf.slice(0, 7);
  const held = classWeights(parts, asOf, rates);
  const ledger = moneyInByMonth(parts, asOf, rates);
  const snapshot = b.months[month];
  const suggested = planMonth(b.budget, b.targets, startOfMonthWeights(held.values, ledger[month]), b.strict);
  const plan = snapshot?.plan ?? suggested;
  const budget = snapshot?.budget ?? b.budget;
  const merged = mergeActual(ledger, b.months);
  const actual = merged[month] ?? {};
  const done = Object.fromEntries(
    SIP_CLASSES.map((k) => [k, !!snapshot?.done[k] || (plan[k] > 0 && (actual[k] ?? 0) >= plan[k] * 0.95)]),
  ) as Record<SipClass, boolean>;
  const totals = totalsByMonth(merged);
  const history = sipHistory(b, totals, month);
  const yearPrefix = asOf.slice(0, 4);
  return {
    month,
    budget,
    plan,
    suggested,
    actual,
    done,
    progress: monthProgress(plan, actual),
    history,
    strip: habitStrip(history.rows, month),
    values: held.values,
    weights: held.weights,
    mix: mixAfter(held.values, plan),
    year: {
      invested: Object.entries(totals)
        .filter(([m]) => m.startsWith(yearPrefix))
        .reduce((n, [, v]) => n + v, 0),
      monthsMet: history.rows.filter((r) => r.met && r.month.startsWith(yearPrefix)).length,
    },
  };
}

/**
 * What Monthly Picks should spend this month: the blueprint's stocks amount minus stocks already bought (ledger or tick).
 * `amount` is what is left, or the whole stocks amount once it is all bought (so a re-run still has a figure).
 */
export type PicksBudget = { month: string; planned: number; bought: number; amount: number; done: boolean };
export function picksBudget(
  b: SipBlueprint,
  parts: (DisplayPart & { locked?: boolean })[],
  asOf: string,
  rates: SipRates = {},
): PicksBudget | null {
  const st = sipMonthState(b, parts, asOf, rates);
  const planned = st.plan.stocks ?? 0;
  if (planned <= 0) return null;
  const bought = Math.round(st.actual.stocks ?? 0);
  const left = Math.max(0, planned - bought);
  const done = st.done.stocks === true;
  return { month: st.month, planned, bought, amount: done || left <= 0 ? planned : roundTo(left, 100), done: done || left <= 0 };
}

// ───────────────────────── the whole screen, in words ─────────────────────────
// Everything the SIP Blueprint shows, worked out once: the month, each class row with what to do next, the habit and
// the hero wording. Shared by the web page and the phone so both say the same thing. Pure: `asOf` comes from the caller.

/** What a class row offers: pick stocks, add to a fund, log a purchase here, or only tick it off. */
export type SipRowAction = 'picks' | 'holdings' | 'log' | 'mark';

export type SipRow = {
  key: SipClass;
  label: string;
  /** What to buy, in plain words ("≈ 0.25 g of 24K at Rs 3.45 lakh/tola"). */
  hint: string;
  amount: number;
  /** The static split for this class this month, for the "above / below target" tag. */
  target: number;
  /** amount − target, rounded to Rs 100; shown when at least Rs 100. */
  diff: number;
  actual: number;
  done: boolean;
  /** The tick came from the person, so it can be undone (a logged purchase is read from the ledger instead). */
  manual: boolean;
  action: SipRowAction;
  /** The public rate used by "Log it" (rupees per gram of 24K, or per unit of currency); null without one. */
  rate: number | null;
};

export type SipHero = {
  month: string;
  /** "Done for October", "Today is your SIP day", "SIP day in 3 days", "SIP day was the 1st". */
  status: string;
  complete: boolean;
  left: number;
  /** The next SIP day and how far away it is. */
  next: { date: string; days: number };
  streak: number;
  encouragement: string;
  /** Set when the month is behind and the person asked to be reminded. */
  nudge: string | null;
};

export type SipView = {
  hero: SipHero;
  rows: SipRow[];
  state: SipMonthState;
  /** The person hand-edited this month's plan. */
  edited: boolean;
  strict: boolean;
  day: number;
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLong = (month: string) => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
export const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** The first day of next month, so a finished month points at the next SIP day. */
function nextMonthStart(asOf: string): string {
  const [y, m] = asOf.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** What to buy, in plain words. Grams and dollars use the public rate the app already has. */
export function rowHint(k: SipClass, amount: number, rates: SipRates, asOf: string): string {
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

/** The public rate "Log it" fills the form from: rupees per gram of 24K gold, or per unit of a currency. */
export function logRate(k: SipClass, rates: SipRates, asOf: string, currency: CurrencyCode = 'USD'): number | null {
  if (k === 'gold') return chooseRate(rates.metalRates ?? [], 'gold', asOf)?.pkrPerGram ?? null;
  if (k === 'currency') return chooseFxRate(rates.fxRates ?? [], currency, asOf)?.pkrPerUnit ?? null;
  return null;
}

/**
 * The whole SIP Blueprint screen for the running month. `canLog` is false when every portfolio is locked (nothing can
 * be written), `hasStocks` false when no company is held yet, so the stocks row offers Holdings instead of Picks.
 */
export function sipView(
  b: SipBlueprint,
  parts: (DisplayPart & { locked?: boolean })[],
  asOf: string,
  rates: SipRates = {},
  options: { canLog?: boolean; hasStocks?: boolean } = {},
): SipView {
  const st = sipMonthState(b, parts, asOf, rates);
  const snapshot = b.months[st.month];
  const canLog = options.canLog ?? parts.some((p) => !p.locked);
  const hasStocks = options.hasStocks ?? parts.some((p) => p.portfolio.companies.length > 0);
  const day = b.day ?? 1;
  const dayOfMonth = Number(asOf.slice(8));
  const left = Math.max(0, st.progress.planned - st.progress.done);
  const complete = st.progress.planned > 0 && left === 0;
  const status = complete
    ? `Done for ${monthLong(st.month)}`
    : dayOfMonth === day
      ? 'Today is your SIP day'
      : dayOfMonth < day
        ? `SIP day in ${day - dayOfMonth} day${day - dayOfMonth === 1 ? '' : 's'}`
        : `SIP day was the ${ordinal(day)}`;
  const behind = b.notify && dayOfMonth >= day + 3 && st.progress.percent < STREAK_THRESHOLD * 100;
  const rows: SipRow[] = SIP_CLASSES.filter((k) => st.plan[k] > 0 || b.targets[k] > 0).map((k) => {
    const amount = st.plan[k];
    const target = Math.round((st.budget * b.targets[k]) / 100 / 100) * 100;
    const done = st.done[k];
    const loggable = canLog && (k === 'gold' || k === 'currency');
    return {
      key: k,
      label: SIP_CLASS_LABELS[k],
      hint: rowHint(k, amount, rates, asOf),
      amount,
      target,
      diff: amount - target,
      actual: st.actual[k] ?? 0,
      done,
      manual: !!snapshot?.done[k],
      action: done ? 'mark' : k === 'stocks' ? (hasStocks ? 'picks' : 'holdings') : k === 'funds' ? 'holdings' : loggable ? 'log' : 'mark',
      rate: logRate(k, rates, asOf),
    };
  });
  return {
    hero: {
      month: st.month,
      status,
      complete,
      left,
      next: nextSipDay(complete ? nextMonthStart(asOf) : asOf, day),
      streak: st.history.streak,
      encouragement: encouragement(st.history.streak, st.history.thisMonthMet, st.progress.percent),
      nudge: behind
        ? `Your SIP day was the ${ordinal(day)}. Invest ${lakh(Math.max(0, Math.round(st.budget * STREAK_THRESHOLD) - st.progress.done))} more this month to keep your streak.`
        : null,
    },
    rows,
    state: st,
    edited: !!snapshot?.edited,
    strict: b.strict,
    day,
  };
}
