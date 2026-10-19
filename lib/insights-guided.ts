// Numbers behind the Guided (beginner) Insights view. Pure: no React, no I/O, no clock (`asOf` is passed in).
//
// Same rules as `lib/insights.ts`: a figure that cannot be known is left out with a reason, never turned into
// zero. Everything runs on the device from the decrypted ledger plus public data; nothing here is sent anywhere.
import { valueAsset } from './assets.ts';
import type { AssetClassKey } from './account-overview.ts';
import { allocationTree, type InsightOptions } from './insights.ts';
import {
  daysBetween,
  moneyInFlows,
  moneyWeightedReturn,
  MIN_RETURN_DAYS,
  type CashFlow,
} from './performance.ts';
import { pktDate, type PricePoint } from './price-history.ts';
import { inflationOn, savingsRateOn } from './pk-benchmarks.ts';
import { TAX_RATES, round, type Dividend, type DisplayPart, type Trade } from './portfolio.ts';

// ───────────────────────── money in, month by month ─────────────────────────

/** Every money-in event across stocks and other assets (positive amounts only), chronological. */
export function moneyInEvents(parts: DisplayPart[], asOf: string, o: InsightOptions = {}): CashFlow[] {
  const out: CashFlow[] = [];
  for (const part of parts) {
    out.push(...moneyInFlows(part.portfolio).flows);
    for (const asset of part.portfolio.assets ?? [])
      out.push(
        ...valueAsset(asset, o.metalRates ?? [], asOf, o.fundNavs ?? [], o.planNavs ?? [], o.fxRates ?? []).flows,
      );
  }
  return out
    .filter((f) => f.date <= asOf && f.amount > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const monthOf = (date: string) => date.slice(0, 7);
function prevMonth(m: string) {
  const [y, mo] = m.split('-').map(Number);
  const i = y * 12 + mo - 2;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export type SipStreak = {
  /** Consecutive months with money in, ending this month or last month. */
  current: number;
  longest: number;
  /** Months with any money in. */
  monthsActive: number;
  /** The current month has money in already. */
  thisMonthDone: boolean;
  /** Months since the first money in, counting this one. */
  monthsSince: number;
};

/** A month counts when any money went in. The current month never breaks a streak until it has ended. */
export function sipStreak(flows: CashFlow[], asOf: string): SipStreak {
  const months = new Set(flows.filter((f) => f.amount > 0 && f.date <= asOf).map((f) => monthOf(f.date)));
  if (!months.size) return { current: 0, longest: 0, monthsActive: 0, thisMonthDone: false, monthsSince: 0 };
  const sorted = [...months].sort();
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const m of sorted) {
    run = prev && prevMonth(m) === prev ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = m;
  }
  const now = monthOf(asOf);
  const thisMonthDone = months.has(now);
  let cursor = thisMonthDone ? now : prevMonth(now);
  let current = 0;
  while (months.has(cursor)) {
    current += 1;
    cursor = prevMonth(cursor);
  }
  const [fy, fm] = sorted[0].split('-').map(Number);
  const [ny, nm] = now.split('-').map(Number);
  return { current, longest, monthsActive: months.size, thisMonthDone, monthsSince: (ny - fy) * 12 + (nm - fm) + 1 };
}

export type BudgetCompletion = {
  months: { month: string; budget: number; invested: number; ratio: number }[];
  /** Average of per-month ratios (each capped at 100%), or null when no month has a budget. */
  average: number | null;
};

/** Money put in against the monthly budget, over the last `count` months (this one included). */
export function budgetCompletion(
  budgets: Record<string, number>,
  flows: CashFlow[],
  asOf: string,
  count = 6,
): BudgetCompletion {
  const rows: BudgetCompletion['months'] = [];
  let m = monthOf(asOf);
  for (let i = 0; i < count; i++) {
    const budget = budgets[m];
    if (budget && budget > 0) {
      const invested = flows
        .filter((f) => f.amount > 0 && monthOf(f.date) === m)
        .reduce((n, f) => n + f.amount, 0);
      rows.push({ month: m, budget, invested: round(invested), ratio: invested / budget });
    }
    m = prevMonth(m);
  }
  rows.reverse();
  return {
    months: rows,
    average: rows.length ? rows.reduce((n, r) => n + Math.min(1, r.ratio), 0) / rows.length : null,
  };
}

// ───────────────────────── growth / stability / hedge ─────────────────────────

export type BucketKey = 'growth' | 'stability' | 'hedge';
export const BUCKET_LABELS: Record<BucketKey, string> = {
  growth: 'Growth',
  stability: 'Stability',
  hedge: 'Hedge',
};
export const BUCKET_ROLES: Record<BucketKey, string> = {
  growth: 'Grows over years. Goes up and down in the short term.',
  stability: 'Keeps your money safe and steady. Good for emergencies.',
  hedge: 'Protects you if the rupee loses value.',
};

/** Equity funds are Growth; money market, income and fixed-return funds are Stability. Unknown wording is Growth. */
export function fundBucket(category: string): { bucket: BucketKey; assumed: boolean } {
  const c = category.toLowerCase();
  if (/gold/.test(c)) return { bucket: 'hedge', assumed: false };
  if (/money market|income|fixed|sovereign|treasury|cash|savings|capital protected|capital preservation/.test(c))
    return { bucket: 'stability', assumed: false };
  if (/equity|index|stock|balanced|asset allocation|aggressive|growth|dedicated|pension/.test(c))
    return { bucket: 'growth', assumed: false };
  return { bucket: 'growth', assumed: true };
}

/** Fund risk band used by the funds spectrum. */
export type RiskBand = 'low' | 'medium' | 'high';
export function fundRisk(category: string): RiskBand {
  const c = category.toLowerCase();
  if (/money market|cash|treasury|sovereign/.test(c)) return 'low';
  if (/income|fixed|capital|savings/.test(c)) return 'medium';
  return 'high';
}

export type BucketItem = {
  name: string;
  value: number;
  classKey: AssetClassKey;
  ticker?: string;
  group: string;
};
export type Bucket = {
  key: BucketKey;
  label: string;
  value: number;
  /** Share of the total, 0 to 100. */
  share: number;
  /** Drill-down: group name (sector, fund category, ...) with its items, largest first. */
  groups: { name: string; value: number; items: BucketItem[] }[];
  /** Some fund in this bucket was placed by guess. */
  assumed: boolean;
};

/** Three buckets with every holding in exactly one. Only positive, known values are counted. */
export function allocationBuckets(
  parts: DisplayPart[],
  asOf: string,
  o: InsightOptions = {},
): { buckets: Bucket[]; total: number } {
  const items: { bucket: BucketKey; item: BucketItem; assumed: boolean }[] = [];
  const tree = allocationTree(parts, asOf, o);
  for (const cls of tree.root) {
    if (cls.classKey !== 'stocks') continue;
    for (const sector of cls.children ?? [])
      for (const leaf of sector.children ?? [])
        items.push({
          bucket: 'growth',
          assumed: false,
          item: { name: leaf.name, value: leaf.value, classKey: 'stocks', ticker: leaf.ticker, group: sector.name },
        });
  }
  for (const part of parts)
    for (const asset of part.portfolio.assets ?? []) {
      const v = valueAsset(asset, o.metalRates ?? [], asOf, o.fundNavs ?? [], o.planNavs ?? [], o.fxRates ?? []);
      if (v.value === null || v.value <= 0) continue;
      let bucket: BucketKey;
      let group: string;
      let assumed = false;
      if (asset.kind === 'fund') {
        const b = fundBucket(asset.category);
        bucket = b.bucket;
        assumed = b.assumed;
        group = asset.category || 'Other funds';
      } else if (asset.kind === 'plan') {
        bucket = 'stability';
        group = 'Savings plans';
      } else if (asset.kind === 'metal') {
        bucket = 'hedge';
        group = v.classKey === 'silver' ? 'Silver' : 'Gold';
      } else {
        bucket = 'hedge';
        group = 'Foreign currency';
      }
      items.push({ bucket, assumed, item: { name: asset.name, value: round(v.value), classKey: v.classKey, group } });
    }
  const total = items.reduce((n, i) => n + i.item.value, 0);
  const buckets = (['growth', 'stability', 'hedge'] as BucketKey[]).map((key): Bucket => {
    const mine = items.filter((i) => i.bucket === key);
    const byGroup = new Map<string, BucketItem[]>();
    for (const i of mine) byGroup.set(i.item.group, [...(byGroup.get(i.item.group) ?? []), i.item]);
    const groups = [...byGroup.entries()]
      .map(([name, list]) => ({
        name,
        items: list.sort((a, b) => b.value - a.value),
        value: round(list.reduce((n, l) => n + l.value, 0)),
      }))
      .sort((a, b) => b.value - a.value);
    const value = round(mine.reduce((n, i) => n + i.item.value, 0));
    return {
      key,
      label: BUCKET_LABELS[key],
      value,
      share: total > 0 ? (value / total) * 100 : 0,
      groups,
      assumed: mine.some((i) => i.assumed),
    };
  });
  return { buckets, total: round(total) };
}

// ───────────────────────── concentration action ─────────────────────────

export const CONCENTRATION_LIMIT_PERCENT = 20;
export type ConcentrationAction = {
  over: { name: string; ticker?: string; share: number }[];
  /** Stocks below an equal share, smallest first: where the next budget could go. */
  under: { name: string; ticker?: string; share: number }[];
};

/** Holdings above the limit and the stocks that would balance them. */
export function concentrationAction(
  leaves: { name: string; value: number; ticker?: string }[],
  limit = CONCENTRATION_LIMIT_PERCENT,
): ConcentrationAction {
  const total = leaves.reduce((n, l) => n + l.value, 0);
  if (total <= 0) return { over: [], under: [] };
  const rows = leaves.map((l) => ({ name: l.name, ticker: l.ticker, share: (l.value / total) * 100 }));
  const equal = 100 / rows.length;
  return {
    over: rows.filter((r) => r.share > limit).sort((a, b) => b.share - a.share),
    under: rows.filter((r) => r.ticker && r.share < equal).sort((a, b) => a.share - b.share),
  };
}

/** What a fall in one holding does to the whole portfolio, in percent of the portfolio. */
export const dropImpact = (share: number, fall = 20) => (share * fall) / 100;

// ───────────────────────── benchmark race ─────────────────────────

export type RaceEntry = {
  key: 'you' | 'kse100' | 'inflation' | 'savings';
  label: string;
  endValue: number;
  rate: number | null;
};
export type BenchmarkRace =
  | { available: false; reason: 'no-flows' | 'too-short' }
  | {
      available: true;
      startDate: string;
      days: number;
      moneyIn: number;
      entries: RaceEntry[];
      /** Why an entry is missing (index history shorter than the window, ...). */
      omitted: { key: RaceEntry['key']; reason: string }[];
      beatsInflation: boolean | null;
    };

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Grows each money-in flow at a yearly percent that can change over time. */
function compound(flows: CashFlow[], asOf: string, rateOn: (date: string) => number | null): number | null {
  let total = 0;
  for (const f of flows) {
    let value = f.amount;
    let d = f.date;
    while (d < asOf) {
      const step = Math.min(30, daysBetween(d, asOf));
      const r = rateOn(d);
      if (r === null) return null;
      value *= Math.pow(1 + r / 100, step / 365);
      d = addDays(d, step);
    }
    total += value;
  }
  return round(total);
}

/**
 * Puts every money-in flow into four places over the same window: your portfolio, the KSE-100, "keeping up with
 * prices" (inflation) and a savings account. `index` is the KSE-100 close history. Benchmarks are estimates and the
 * page says so.
 */
export function benchmarkRace(input: {
  flows: CashFlow[];
  currentValue: number;
  asOf: string;
  index: PricePoint[];
}): BenchmarkRace {
  const inFlows = input.flows.filter((f) => f.amount > 0 && f.date <= input.asOf);
  if (!inFlows.length) return { available: false, reason: 'no-flows' };
  const startDate = inFlows[0].date;
  const days = daysBetween(startDate, input.asOf);
  if (days < MIN_RETURN_DAYS) return { available: false, reason: 'too-short' };
  const moneyIn = round(inFlows.reduce((n, f) => n + f.amount, 0));
  const entries: RaceEntry[] = [];
  const omitted: { key: RaceEntry['key']; reason: string }[] = [];
  const rateOf = (end: number): number | null => moneyWeightedReturn(inFlows, end, input.asOf).rate;

  entries.push({
    key: 'you',
    label: 'Your portfolio',
    endValue: round(input.currentValue),
    rate: rateOf(input.currentValue),
  });

  const closes = input.index
    .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0)
    .map(([sec, c]): [string, number] => [pktDate(sec), c])
    .filter(([d]) => d <= input.asOf)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const closeOnOrBefore = (date: string) => {
    let found: number | null = null;
    for (const [d, c] of closes) {
      if (d <= date) found = c;
      else break;
    }
    return found;
  };
  const last = closes.length ? closes[closes.length - 1][1] : null;
  if (last === null) omitted.push({ key: 'kse100', reason: 'No KSE-100 history loaded yet.' });
  else if (closes[0][0] > startDate)
    omitted.push({ key: 'kse100', reason: `KSE-100 history starts ${closes[0][0]}, after your first investment.` });
  else {
    let end = 0;
    for (const f of inFlows) end += (f.amount / (closeOnOrBefore(f.date) ?? last)) * last;
    entries.push({ key: 'kse100', label: 'KSE-100 index', endValue: round(end), rate: rateOf(end) });
  }

  const infl = compound(inFlows, input.asOf, inflationOn);
  if (infl === null) omitted.push({ key: 'inflation', reason: 'Inflation history does not reach back that far.' });
  else entries.push({ key: 'inflation', label: 'Prices rising (inflation)', endValue: infl, rate: rateOf(infl) });

  const sav = compound(inFlows, input.asOf, savingsRateOn);
  if (sav === null) omitted.push({ key: 'savings', reason: 'Savings rate history does not reach back that far.' });
  else entries.push({ key: 'savings', label: 'Bank savings (estimate)', endValue: sav, rate: rateOf(sav) });

  const inflation = entries.find((e) => e.key === 'inflation');
  return {
    available: true,
    startDate,
    days,
    moneyIn,
    entries,
    omitted,
    beatsInflation: inflation ? entries[0].endValue > inflation.endValue : null,
  };
}

// ───────────────────────── income run-rate ─────────────────────────

export type RunRate =
  | { annual: number; monthly: number }
  | { annual: null; reason: 'no-history' | 'none-yet' };

/** Income received over the last 12 months, taken as the pace for the next 12. Null with a reason when too little history. */
export function incomeRunRate(
  months: { month: string; amount: number }[],
  firstMoneyIn: string | null,
  asOf: string,
): RunRate {
  if (!firstMoneyIn || daysBetween(firstMoneyIn, asOf) < MIN_RETURN_DAYS) return { annual: null, reason: 'no-history' };
  const annual = months.slice(-12).reduce((n, m) => n + m.amount, 0);
  if (annual <= 0) return { annual: null, reason: 'none-yet' };
  return { annual: round(annual), monthly: round(annual / 12) };
}

// ───────────────────────── milestones ─────────────────────────

export type Milestone = { key: string; text: string };

const MONEY_STEPS = [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000];
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;

/** Friendly "you have achieved" lines, most meaningful first. Empty when there is nothing honest to say. */
export function milestones(input: {
  stabilityValue: number;
  monthlyExpenses: number | null;
  incomeThisYear: number;
  moneyIn: number;
  streak: SipStreak;
}): Milestone[] {
  const out: Milestone[] = [];
  const exp = input.monthlyExpenses;
  if (exp && exp > 0) {
    const months = Math.floor(input.stabilityValue / exp);
    if (months >= 1)
      out.push({
        key: 'emergency',
        text: `Your stable savings cover about ${months} ${months === 1 ? 'month' : 'months'} of expenses.`,
      });
    if (input.incomeThisYear > 0)
      out.push({
        key: 'income-expenses',
        text: `Your investments paid you ${rs(input.incomeThisYear)} this tax year, enough for ${(input.incomeThisYear / exp).toFixed(1)} months of expenses.`,
      });
  } else if (input.incomeThisYear > 0) {
    out.push({ key: 'income', text: `Your investments paid you ${rs(input.incomeThisYear)} this tax year.` });
  }
  const step = [...MONEY_STEPS].reverse().find((s) => input.moneyIn >= s);
  if (step) out.push({ key: 'money-in', text: `You have put ${rs(step)} to work from your own pocket.` });
  if (input.streak.current >= 3)
    out.push({
      key: 'streak',
      text: `${input.streak.current} months in a row. Steady investing is what builds wealth.`,
    });
  return out;
}

// ───────────────────────── projection ─────────────────────────

export type Projection = { years: number; low: number; base: number; high: number; contributed: number };

/** Value of a lump sum plus monthly savings after `years`, at a yearly percent. Contributions at month end. */
export function futureValue(current: number, monthly: number, annualPercent: number, years: number): number {
  const r = annualPercent / 100 / 12;
  const n = years * 12;
  const growth = r === 0 ? n * monthly : monthly * ((Math.pow(1 + r, n) - 1) / r);
  return current * Math.pow(1 + r, n) + growth;
}

/** Low, base and high paths for 3, 5 and 10 years. Estimates only: the page must not present them as promises. */
export function fundProjection(input: {
  current: number;
  monthly: number;
  /** Yearly percent for the base path. Low and high are base minus and plus `band` points. */
  basePercent: number;
  band?: number;
  years?: number[];
}): Projection[] {
  const band = input.band ?? 3;
  return (input.years ?? [3, 5, 10]).map((years) => ({
    years,
    low: round(futureValue(input.current, input.monthly, Math.max(0, input.basePercent - band), years)),
    base: round(futureValue(input.current, input.monthly, input.basePercent, years)),
    high: round(futureValue(input.current, input.monthly, input.basePercent + band, years)),
    contributed: round(input.current + input.monthly * years * 12),
  }));
}

/** Yearly percent a fund returned over its price history (first to last), or null for under 90 days of history. */
export function trailingReturn(navs: { date: string; nav: number }[]): number | null {
  const rows = navs.filter((n) => n.nav > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (rows.length < 2) return null;
  const days = daysBetween(rows[0].date, rows[rows.length - 1].date);
  if (days < MIN_RETURN_DAYS) return null;
  return (Math.pow(rows[rows.length - 1].nav / rows[0].nav, 365 / days) - 1) * 100;
}

/** Average money in per month over the last `months` calendar months, this one included. */
export function monthlyPace(flows: CashFlow[], asOf: string, months = 6): number {
  let since = monthOf(asOf);
  for (let i = 1; i < months; i++) since = prevMonth(since);
  const total = flows
    .filter((f) => f.amount > 0 && monthOf(f.date) >= since && f.date <= asOf)
    .reduce((n, f) => n + f.amount, 0);
  return round(total / months);
}

// ───────────────────────── hedge share ─────────────────────────

export const HEDGE_TARGET = { min: 10, max: 20 };
export function hedgeStatus(share: number): 'below' | 'in' | 'above' {
  return share < HEDGE_TARGET.min ? 'below' : share > HEDGE_TARGET.max ? 'above' : 'in';
}

// ───────────────────────── rupee-cost averaging ─────────────────────────

export type Rca = {
  ticker: string;
  buys: number;
  avgCost: number;
  low: number;
  high: number;
  /** Buys made below the average cost at the time. */
  dipBuys: number;
  /** Price above (positive) or below the average cost, percent; null without a price. */
  vsCostPercent: number | null;
};

export function rcaSummary(trades: Trade[], ticker: string, price: number | null): Rca | null {
  const buys = trades
    .filter(
      (t) =>
        t.ticker === ticker &&
        !t.voided &&
        (t.kind === 'buy' || t.kind === 'opening') &&
        t.price !== null &&
        t.shares > 0,
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!buys.length) return null;
  let shares = 0;
  let cost = 0;
  let dips = 0;
  for (const t of buys) {
    const p = t.price!;
    if (shares > 0 && p < cost / shares) dips += 1;
    shares += t.shares;
    cost += t.shares * p;
  }
  const avg = cost / shares;
  const prices = buys.map((t) => t.price!);
  return {
    ticker,
    buys: buys.length,
    avgCost: round(avg),
    low: Math.min(...prices),
    high: Math.max(...prices),
    dipBuys: dips,
    vsCostPercent: price !== null && avg > 0 ? ((price - avg) / avg) * 100 : null,
  };
}

export type HoldingTag = 'Long-term core' | 'Dividend payer' | 'Growth';
export function holdingTags(input: {
  firstBuyDate: string | null;
  share: number;
  paidIncomeLastYear: boolean;
  gain: number | null;
  asOf: string;
}): HoldingTag[] {
  const tags: HoldingTag[] = [];
  if (input.firstBuyDate && daysBetween(input.firstBuyDate, input.asOf) >= 365 && input.share >= 10)
    tags.push('Long-term core');
  if (input.paidIncomeLastYear) tags.push('Dividend payer');
  else if (input.gain !== null && input.gain > 0) tags.push('Growth');
  return tags;
}

// ───────────────────────── dividend tax ─────────────────────────

export type DividendTaxView = {
  gross: number;
  /** Tax actually withheld where recorded, otherwise the estimate from the filer status. */
  tax: number;
  net: number;
  status: 'filer' | 'non-filer' | null;
  /** Some of the tax is an estimate from the filer status. */
  estimated: boolean;
};

/** Received dividends in a tax year: gross, tax and net. Without a filer status no tax is invented. */
export function dividendTaxView(
  dividends: Dividend[],
  status: 'filer' | 'non-filer' | null,
  taxYear: string,
  taxYearOf: (date: string) => string,
): DividendTaxView {
  let gross = 0;
  let tax = 0;
  let estimated = false;
  for (const d of dividends) {
    if (d.voided || d.status === 'expected') continue;
    const date = d.paymentDate ?? d.date;
    if (taxYearOf(date) !== taxYear) continue;
    const g =
      d.grossAmount ??
      (d.netAmount !== undefined && d.taxWithheld !== undefined ? d.netAmount + d.taxWithheld : 0);
    if (g <= 0) continue;
    gross += g;
    if (d.taxWithheld !== undefined) tax += d.taxWithheld;
    else if (status) {
      tax += g * TAX_RATES[status];
      estimated = true;
    }
  }
  return { gross: round(gross), tax: round(tax), net: round(gross - tax), status, estimated };
}

// ───────────────────────── purchasing power ─────────────────────────

/** What the money put in would be worth today if it had been held in a reference (dollars or gold) instead. */
export function heldInReference(
  flows: CashFlow[],
  priceOn: (date: string) => number | null,
  priceNow: number | null,
): number | null {
  if (priceNow === null || priceNow <= 0) return null;
  let units = 0;
  for (const f of flows) {
    if (f.amount <= 0) continue;
    const p = priceOn(f.date);
    if (p === null || p <= 0) return null;
    units += f.amount / p;
  }
  return round(units * priceNow);
}
