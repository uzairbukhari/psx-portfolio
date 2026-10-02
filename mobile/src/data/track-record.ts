// View-models for "Value vs money in", the money-weighted return and the KSE-100 comparison (pure). The maths is
// in lib/performance.ts; this decides what to show, what to withhold and how to word it.
import {
  benchmarkComparison,
  daysBetween,
  moneyInFlows,
  MIN_RETURN_DAYS,
  moneyWeightedReturn,
  tradedTickers,
  valueVsMoneyIn,
  type BenchmarkComparison,
  type MoneyWeightedReturn,
  type ValueVsMoneyIn,
} from '../../../lib/performance.ts';
import { moneyShort as money, type Portfolio } from '../../../lib/portfolio.ts';
import { parseEod, type PricePoint } from '../../../lib/price-history.ts';
import { signedAmountLabel, signedPercentLabel } from './a11y.ts';
import { shortDate, signedMoney, signedPercent } from './format.ts';

export const INDEX_TICKER = 'KSE100';
export type TrackRange = '1m' | '6m' | '1y' | 'all';
export const TRACK_RANGES: { key: TrackRange; label: string; spoken: string }[] = [
  { key: '1m', label: '1M', spoken: 'One month' },
  { key: '6m', label: '6M', spoken: 'Six months' },
  { key: '1y', label: '1Y', spoken: 'One year' },
  { key: 'all', label: 'All', spoken: 'All time' },
];
const RANGE_DAYS: Record<Exclude<TrackRange, 'all'>, number> = { '1m': 31, '6m': 183, '1y': 366 };

/** The history endpoint takes at most 60 symbols; the index rides in the first batch. */
export function historyBatches(tickers: string[], size = 59): string[][] {
  const list = [...new Set(tickers.filter((t) => t !== INDEX_TICKER))];
  const out: string[][] = [];
  for (let i = 0; i < Math.max(list.length, 1); i += size) out.push(list.slice(i, i + size));
  out[0] = [INDEX_TICKER, ...out[0]];
  return out;
}

/** Keeps points within `range` of the last one. */
export function sliceByRange<T extends { date: string }>(points: T[], range: TrackRange): T[] {
  if (range === 'all' || !points.length) return points;
  const end = new Date(`${points[points.length - 1].date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - RANGE_DAYS[range]);
  const from = end.toISOString().slice(0, 10);
  return points.filter((p) => p.date >= from);
}

const yearOf = (iso: string) => Number(iso.slice(0, 4));
const sentenceList = (items: string[]) => (items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

export type ValueChartView =
  | { kind: 'empty'; reason: string }
  | {
      kind: 'chart';
      /** Chronological [dayNumber, value] and [dayNumber, moneyIn] for the two lines. */
      value: [number, number][];
      moneyIn: [number, number][];
      /** Visible line above the chart, and the same for a screen reader. */
      summary: string;
      spoken: string;
      notes: string[];
    };

const dayNum = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

export function valueChartView(v: ValueVsMoneyIn, range: TrackRange, thisYear: number): ValueChartView {
  const notes: string[] = [];
  if (v.unpriced.length) notes.push(`No price history yet for ${sentenceList(v.unpriced)}, so ${v.unpriced.length === 1 ? 'its' : 'their'} value is left out of the chart.`);
  if (v.unknownCost.length) notes.push(`The cost of ${sentenceList(v.unknownCost)} is not known, so ${v.unknownCost.length === 1 ? 'its' : 'their'} money in is left out. The gap between the lines overstates growth.`);
  if (v.inconsistent.length) notes.push(`${sentenceList(v.inconsistent)} ${v.inconsistent.length === 1 ? 'has' : 'have'} sales larger than the shares held. Check Activity.`);
  const points = sliceByRange(v.points, range);
  if (points.length < 2) {
    const why = v.points.length < 2 ? (v.firstFlowDate === null ? 'Add a buy to see how your value compares with the money you put in.' : 'Price history is not available yet for enough days to draw a chart.') : 'Not enough days in this range. Choose a longer one.';
    return { kind: 'empty', reason: [why, ...notes].join(' ') };
  }
  if (v.startsLater && range === 'all' && v.firstFlowDate)
    notes.push(`The chart starts on ${shortDate(v.points[0].date, thisYear)}, the first day every holding could be priced. Your first entry is dated ${shortDate(v.firstFlowDate, thisYear)}.`);
  const last = points[points.length - 1];
  const gap = Math.round((last.value - last.moneyIn) * 100) / 100;
  const pct = last.moneyIn > 0 ? (gap / last.moneyIn) * 100 : null;
  const as = `as of ${shortDate(last.date, thisYear)}`;
  const visible = `Value ${money(last.value)} against ${money(last.moneyIn)} put in: ${signedMoney(gap)}${pct === null ? '' : ` (${signedPercent(pct)})`} ${as}.`;
  const spoken = `Value ${money(last.value)} against ${money(last.moneyIn)} put in: ${signedAmountLabel(gap, money)}${pct === null ? '' : `, ${signedPercentLabel(pct)}`} ${as}. Dividends are not counted.`;
  return {
    kind: 'chart',
    value: points.map((p) => [dayNum(p.date), p.value]),
    moneyIn: points.map((p) => [dayNum(p.date), p.moneyIn]),
    summary: visible,
    spoken,
    notes,
  };
}

export type ReturnView = {
  /** "+12.3% a year", or null when it cannot be shown. */
  headline: string | null;
  spoken: string | null;
  /** Why there is no figure, or a caveat when there is one. */
  note: string | null;
};

const ratePct = (rate: number) => rate * 100;
const perYear = (rate: number) => `${signedPercent(ratePct(rate))} a year`;
const perYearSpoken = (rate: number) => `${rate >= 0 ? 'up' : 'down'} ${Math.abs(ratePct(rate)).toFixed(1)} percent a year`;

export function returnView(r: MoneyWeightedReturn, block: string | null): ReturnView {
  if (block) return { headline: null, spoken: null, note: block };
  if (r.reason === 'ok' && r.rate !== null) return { headline: perYear(r.rate), spoken: perYearSpoken(r.rate), note: null };
  if (r.reason === 'too-short') return { headline: null, spoken: null, note: `A yearly rate needs at least ${MIN_RETURN_DAYS} days of history; yours is ${r.days} so far.` };
  if (r.reason === 'no-flows') return { headline: null, spoken: null, note: 'Add a buy to see your money-weighted return.' };
  return { headline: null, spoken: null, note: 'No yearly rate fits these cash flows.' };
}

export type BenchmarkView =
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'chart';
      portfolio: [number, number][];
      benchmark: [number, number][];
      summary: string;
      spoken: string;
      yours: ReturnView;
      index: ReturnView;
      notes: string[];
      legend: string;
    };

const BENCHMARK_REASONS: Record<Extract<BenchmarkComparison, { available: false }>['reason'], string> = {
  'no-index': 'KSE-100 daily history has not been collected yet, so no comparison is drawn rather than an unfair one.',
  'no-flows': 'Add a buy to compare with the KSE-100.',
  'no-overlap': 'Your price history and the KSE-100 history do not overlap yet.',
  'no-value-series': 'Daily price history for your holdings is not available yet, so there is nothing to compare.',
};

export function benchmarkView(b: BenchmarkComparison, range: TrackRange, thisYear: number, block: string | null): BenchmarkView {
  if (block) return { kind: 'unavailable', reason: block };
  if (!b.available) return { kind: 'unavailable', reason: BENCHMARK_REASONS[b.reason] };
  const points = sliceByRange(b.points, range);
  if (points.length < 2) return { kind: 'unavailable', reason: 'Not enough days in this range. Choose a longer one.' };
  const notes: string[] = [];
  if (b.truncated)
    notes.push(
      `KSE-100 history starts on ${shortDate(b.startDate, thisYear)}, later than your first entry (${shortDate(b.firstFlowDate, thisYear)}). The comparison starts on ${shortDate(b.startDate, thisYear)} with your portfolio’s value that day.`,
    );
  if (b.cappedSale) notes.push('A sale was larger than the index position would have held, so it was capped at what the index held.');
  const behind = daysBetween(b.indexAsOf, points[points.length - 1].date);
  if (behind > 4) notes.push(`The latest KSE-100 close used is from ${shortDate(b.indexAsOf, thisYear)}.`);
  const last = points[points.length - 1];
  const diff = Math.round((last.portfolio - last.benchmark) * 100) / 100;
  const as = `as of ${shortDate(last.date, thisYear)}`;
  const word = diff === 0 ? 'level with' : diff > 0 ? 'ahead of' : 'behind';
  const visible = `Your portfolio ${money(last.portfolio)} against ${money(last.benchmark)} had the same money gone into the KSE-100 ${as}: ${diff === 0 ? 'level' : `${signedMoney(diff)} ${diff > 0 ? 'ahead' : 'behind'}`}.`;
  const spoken = `Your portfolio is ${money(last.portfolio)}. The same cash flows in the KSE-100 price index would be ${money(last.benchmark)}. You are ${word} the index${diff === 0 ? '' : ` by ${money(Math.abs(diff))}`} ${as}. Dividends are not included on either side of the index figure.`;
  return {
    kind: 'chart',
    portfolio: points.map((p) => [dayNum(p.date), p.portfolio]),
    benchmark: points.map((p) => [dayNum(p.date), p.benchmark]),
    summary: visible,
    spoken,
    yours: returnView(b.portfolioReturn, null),
    index: returnView(b.benchmarkReturn, null),
    notes,
    legend: 'KSE-100 price index (dividends excluded), same cash flows',
  };
}

export type TrackRecord = {
  value: ValueVsMoneyIn;
  currentValue: number | null;
  /** Reason the money-weighted return is withheld, or null. */
  block: string | null;
  /** Reason the benchmark comparison is withheld (the above, or a holding with no price history), or null. */
  benchmarkBlock: string | null;
  mwr: MoneyWeightedReturn;
  benchmark: BenchmarkComparison;
};

/**
 * Everything the charts need. `currentValue` is the live portfolio value (null while a holding has no price);
 * the return and comparison are withheld while a price or a cost is missing, rather than shown wrong.
 */
export function buildTrackRecord(input: {
  portfolio: Portfolio;
  histories: Record<string, unknown[][]>;
  asOf: string;
  currentValue: number | null;
  missingPrice: string[];
}): TrackRecord {
  const { portfolio, asOf } = input;
  const eod: Record<string, PricePoint[]> = {};
  for (const t of tradedTickers(portfolio)) if (input.histories[t]) eod[t] = parseEod(input.histories[t] as number[][]);
  const index = input.histories[INDEX_TICKER] ? parseEod(input.histories[INDEX_TICKER] as number[][]) : [];
  const value = valueVsMoneyIn(portfolio, eod);
  const { flows } = moneyInFlows(portfolio);
  let block: string | null = null;
  if (value.unknownCost.length) block = `Needs the cost of ${sentenceList(value.unknownCost)}. Edit the opening entry to add it.`;
  else if (input.missingPrice.length || input.currentValue === null) block = `Needs a price for ${sentenceList(input.missingPrice.length ? input.missingPrice : ['your holdings'])}.`;
  else if (value.inconsistent.length) block = `Check Activity: ${sentenceList(value.inconsistent)} ${value.inconsistent.length === 1 ? 'has' : 'have'} sales larger than the shares held.`;
  const current = input.currentValue ?? 0;
  return {
    value,
    currentValue: input.currentValue,
    block,
    benchmarkBlock: block ?? (value.unpriced.length ? `No price history yet for ${sentenceList(value.unpriced)}, so an even comparison with the KSE-100 is not possible.` : null),
    mwr: moneyWeightedReturn(flows, current, asOf),
    benchmark: benchmarkComparison({ flows, valueSeries: value.points, index, currentValue: current, asOf }),
  };
}
