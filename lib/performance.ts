// Money-in, money-weighted return (XIRR) and KSE-100 benchmark maths. Pure: no React, no I/O, no clock.
//
// Definitions (the same wording is shown to users):
// - Money in: buys and opening balances add shares x price + fees; sells subtract shares x price - fees
//   (net proceeds). Dividends, capital-gains tax withheld and splits are not cash flows here. Voided trades are
//   ignored. A buy or opening balance without a price has an unknown cost, so it adds nothing and is listed in
//   `unknownCost`; every result built on it says it is incomplete.
// - XIRR: the annual rate r at which dated cash flows (money paid in negative, money taken out and the current
//   value positive) have a net present value of zero, with years = days / 365.
// - Benchmark: the same cash flows invested in the KSE-100 price index on the same dates at the nearest close on
//   or before each date. The index is a price index, so dividends are not included.
import { round, type Portfolio } from './portfolio.ts';
import { pktDate, portfolioValueSeries, type PricePoint } from './price-history.ts';

/** Positive = money put in (buy), negative = money taken out (sale proceeds). */
export type CashFlow = { date: string; amount: number };

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Net money in per ledger date, chronological. */
export function moneyInFlows(p: Portfolio): { flows: CashFlow[]; unknownCost: string[] } {
  const byDate = new Map<string, number>();
  const unknown = new Set<string>();
  for (const t of p.trades) {
    if (t.voided) continue;
    if (t.price === null) {
      unknown.add(t.ticker);
      continue;
    }
    const amount = t.kind === 'sell' ? -(t.shares * t.price - t.fees) : t.shares * t.price + t.fees;
    byDate.set(t.date, (byDate.get(t.date) ?? 0) + amount);
  }
  const flows = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, amount]): CashFlow => ({ date, amount: cents(amount) }))
    .filter((f) => f.amount !== 0);
  return { flows, unknownCost: [...unknown].sort() };
}

/** Cumulative net money in at the end of each given date (dates ascending). */
export function moneyInSeries(flows: CashFlow[], dates: string[]): number[] {
  const sorted = [...flows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let i = 0;
  let total = 0;
  return dates.map((d) => {
    while (i < sorted.length && sorted[i].date <= d) total += sorted[i++].amount;
    return cents(total);
  });
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round(dayNumber(to) - dayNumber(from));

export type ValueVsMoneyInPoint = { date: string; value: number; moneyIn: number };
export type ValueVsMoneyIn = {
  points: ValueVsMoneyInPoint[];
  /** Date of the first ledger cash flow, if any. */
  firstFlowDate: string | null;
  /** The series starts after the first cash flow because earlier days could not be priced. */
  startsLater: boolean;
  /** Held tickers with no price history; their value is left out. */
  unpriced: string[];
  /** Tickers whose cost is unknown; their money in is left out. */
  unknownCost: string[];
  inconsistent: string[];
  incomplete: boolean;
};

/** Daily portfolio value (from per-ticker closes, carried over gaps) next to cumulative money in. */
export function valueVsMoneyIn(p: Portfolio, eodByTicker: Record<string, PricePoint[]>): ValueVsMoneyIn {
  const { flows, unknownCost } = moneyInFlows(p);
  const { points, unpriced, inconsistent } = portfolioValueSeries(p, eodByTicker);
  const moneyIn = moneyInSeries(flows, points.map((pt) => pt.date));
  const firstFlowDate = flows[0]?.date ?? null;
  return {
    points: points.map((pt, i) => ({ date: pt.date, value: pt.value, moneyIn: moneyIn[i] })),
    firstFlowDate,
    startsLater: firstFlowDate !== null && points.length > 0 && points[0].date > firstFlowDate,
    unpriced,
    unknownCost,
    inconsistent,
    incomplete: unpriced.length > 0 || unknownCost.length > 0 || inconsistent.length > 0,
  };
}

/**
 * Annualised money-weighted return. `flows` use the investor's view: money paid in is negative, money received
 * (sales, and the current value as the last flow) positive. Returns a fraction (0.12 = 12% a year) or null when
 * there is no solution: fewer than two dated flows, all flows one sign, or all on one date.
 * Newton's method from 10%, falling back to bisection on a sign-change bracket.
 */
export function xirr(flows: CashFlow[]): number | null {
  const byDate = new Map<string, number>();
  for (const f of flows) {
    if (!Number.isFinite(f.amount) || !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return null;
    byDate.set(f.date, (byDate.get(f.date) ?? 0) + f.amount);
  }
  const list = [...byDate.entries()].filter(([, a]) => a !== 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (list.length < 2 || !list.some(([, a]) => a < 0) || !list.some(([, a]) => a > 0)) return null;
  const t0 = dayNumber(list[0][0]);
  const years = list.map(([d]) => (dayNumber(d) - t0) / 365);
  if (years[years.length - 1] <= 0) return null;
  const amounts = list.map(([, a]) => a);
  const npv = (r: number) => amounts.reduce((sum, a, i) => sum + a * Math.pow(1 + r, -years[i]), 0);
  const slope = (r: number) => amounts.reduce((sum, a, i) => sum - (years[i] * a * Math.pow(1 + r, -years[i] - 1)), 0);
  const scale = amounts.reduce((m, a) => Math.max(m, Math.abs(a)), 0);
  const close = (r: number) => Math.abs(npv(r)) <= 1e-7 * scale;

  let r = 0.1;
  for (let i = 0; i < 60; i++) {
    const f = npv(r);
    const d = slope(r);
    if (!Number.isFinite(f) || !Number.isFinite(d) || d === 0) break;
    const next = r - f / d;
    if (!Number.isFinite(next) || next <= -1) break;
    if (Math.abs(next - r) < 1e-12) {
      r = next;
      return close(r) ? r : bisect();
    }
    r = next;
  }
  if (close(r) && r > -1) return r;
  return bisect();

  function bisect(): number | null {
    let lo = -0.999999;
    let hi = 1;
    let flo = npv(lo);
    if (!Number.isFinite(flo)) return null;
    let fhi = npv(hi);
    while (Math.sign(fhi) === Math.sign(flo) && hi < 1e6) {
      hi *= 4;
      fhi = npv(hi);
    }
    if (!Number.isFinite(fhi) || Math.sign(fhi) === Math.sign(flo) || fhi === 0 || flo === 0)
      return flo === 0 ? lo : fhi === 0 ? hi : null;
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2;
      const fm = npv(mid);
      if (!Number.isFinite(fm)) return null;
      if (fm === 0 || (hi - lo) / 2 < 1e-13) return mid;
      if (Math.sign(fm) === Math.sign(flo)) {
        lo = mid;
        flo = fm;
      } else hi = mid;
    }
    return (lo + hi) / 2;
  }
}

/** A return needs a reasonable span: annualising a few weeks produces meaningless numbers. */
export const MIN_RETURN_DAYS = 90;

export type MoneyWeightedReturn = {
  /** Annual rate as a fraction, or null (see `reason`). */
  rate: number | null;
  reason: 'ok' | 'no-flows' | 'too-short' | 'no-solution';
  /** Days from the first cash flow to `asOf`. */
  days: number;
};

/** Investor-view flows (paid in negative) plus the current value dated `asOf` as the terminal flow. */
export function moneyWeightedReturn(flows: CashFlow[], currentValue: number, asOf: string): MoneyWeightedReturn {
  const used = flows.filter((f) => f.date <= asOf);
  if (!used.length) return { rate: null, reason: 'no-flows', days: 0 };
  const days = daysBetween(used[0].date, asOf);
  if (days < MIN_RETURN_DAYS) return { rate: null, reason: 'too-short', days };
  const investor = [...used.map((f) => ({ date: f.date, amount: -f.amount })), { date: asOf, amount: currentValue }];
  const rate = xirr(investor);
  return rate === null ? { rate: null, reason: 'no-solution', days } : { rate, reason: 'ok', days };
}

export type BenchmarkPoint = { date: string; portfolio: number; benchmark: number };
export type BenchmarkComparison =
  | { available: false; reason: 'no-index' | 'no-flows' | 'no-overlap' | 'no-value-series' }
  | {
      available: true;
      /** First day of the comparison. */
      startDate: string;
      /** The user's first cash flow is older than the index history; the comparison starts at `startDate`. */
      truncated: boolean;
      firstFlowDate: string;
      /** Date of the last index close used. */
      indexAsOf: string;
      points: BenchmarkPoint[];
      portfolioEnd: number;
      benchmarkEnd: number;
      portfolioReturn: MoneyWeightedReturn;
      benchmarkReturn: MoneyWeightedReturn;
      /** A sale was larger than the benchmark position and was capped at what the benchmark held. */
      cappedSale: boolean;
    };

/**
 * Invests each net cash flow into the index on the same date (nearest close on or before) and compares with the
 * portfolio over the window both have data for. `valueSeries` is the daily portfolio value; `currentValue` the
 * live value dated `asOf` (the terminal flow for both returns). When the first flow predates the index, the
 * window starts at the first index date and the portfolio's value that day is the opening amount for both sides.
 * A sale larger than the benchmark holds is capped at its holding.
 */
export function benchmarkComparison(input: {
  flows: CashFlow[];
  valueSeries: { date: string; value: number }[];
  index: PricePoint[];
  currentValue: number;
  asOf: string;
}): BenchmarkComparison {
  const closes = input.index
    .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0)
    .map(([sec, c]): [string, number] => [pktDate(sec), c])
    .filter(([d]) => d <= input.asOf)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (!closes.length) return { available: false, reason: 'no-index' };
  const flows = input.flows.filter((f) => f.date <= input.asOf).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!flows.length) return { available: false, reason: 'no-flows' };
  const firstFlowDate = flows[0].date;
  const indexStart = closes[0][0];
  const truncated = firstFlowDate < indexStart;
  const startDate = truncated ? indexStart : firstFlowDate;
  const series = input.valueSeries.filter((p) => p.date >= startDate && p.date <= input.asOf);
  if (!series.length) return { available: false, reason: truncated ? 'no-overlap' : 'no-value-series' };

  let opening: CashFlow[] = flows.filter((f) => f.date >= startDate);
  if (truncated) {
    // Everything before the index starts is folded into the portfolio's value at the first index date.
    const before = input.valueSeries.filter((p) => p.date <= startDate).at(-1);
    if (!before) return { available: false, reason: 'no-value-series' };
    opening = [{ date: startDate, amount: before.value }, ...flows.filter((f) => f.date > startDate)];
    // Day-one flows are already inside that value.
  }
  const closeOnOrBefore = (date: string): number | null => {
    let lo = 0;
    let hi = closes.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (closes[mid][0] <= date) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found < 0 ? null : closes[found][1];
  };

  let units = 0;
  let capped = false;
  const benchFlows: CashFlow[] = [];
  let fi = 0;
  const points: BenchmarkPoint[] = [];
  const apply = (until: string) => {
    while (fi < opening.length && opening[fi].date <= until) {
      const f = opening[fi++];
      const close = closeOnOrBefore(f.date);
      if (close === null) continue;
      if (f.amount >= 0) {
        units += f.amount / close;
        benchFlows.push(f);
      } else {
        const wanted = -f.amount;
        const held = units * close;
        const taken = Math.min(wanted, held);
        if (wanted > held + 0.005) capped = true;
        units -= taken / close;
        benchFlows.push({ date: f.date, amount: -taken });
      }
    }
  };
  for (const pt of series) {
    apply(pt.date);
    const close = closeOnOrBefore(pt.date);
    if (close === null) continue;
    points.push({ date: pt.date, portfolio: pt.value, benchmark: cents(units * close) });
  }
  apply(input.asOf);
  const indexAsOf = closes[closes.length - 1][0];
  const benchmarkEnd = cents(units * closes[closes.length - 1][1]);
  const portfolioEnd = round(input.currentValue);
  return {
    available: true,
    startDate,
    truncated,
    firstFlowDate,
    indexAsOf,
    points,
    portfolioEnd,
    benchmarkEnd,
    portfolioReturn: moneyWeightedReturn(opening, input.currentValue, input.asOf),
    benchmarkReturn: moneyWeightedReturn(benchFlows, benchmarkEnd, input.asOf),
    cappedSale: capped,
  };
}

/** Held or ever-traded tickers (open positions and sold-out ones), for fetching their price histories. */
export function tradedTickers(p: Portfolio): string[] {
  return [...new Set(p.trades.filter((t) => !t.voided).map((t) => t.ticker))].sort();
}
