// Market breakpoints for the Monthly Picks score. A company is scored against every PSX company the app tracks,
// not only the shortlist, so a score does not move when the person adds or removes a candidate and a shortlist of
// one can still be scored. The breakpoints are public numbers: one row, written once a day by the facts scraper from
// the cached company pages (scripts/psx-facts-scrape.mjs). Nothing here involves a person's data.
import type { CompanyMetrics } from './company-facts.ts';

export type BenchmarkKey = 'valuation' | 'growth' | 'profitability' | 'momentum';
export const BENCHMARK_KEYS: BenchmarkKey[] = ['valuation', 'growth', 'profitability', 'momentum'];
/** Breakpoints every 5 percentile points: 0, 5, 10, ... 100 (21 values per metric). */
export const BENCHMARK_STEPS = 21;
/** Fewer companies than this and the market is too thin to rank against: the score falls back to the shortlist. */
export const MIN_BENCHMARK_SAMPLE = 15;
/** A metric needs at least this many values to be ranked against. */
const MIN_VALUES = 10;
/** A row older than this is ignored rather than used to score today's companies. */
export const BENCHMARK_MAX_AGE_DAYS = 30;

export type FactsBenchmarks = {
  computedOn: string;
  /** Companies with usable data when the breakpoints were taken. */
  sample: number;
  /** Sorted breakpoints per metric; an empty list means that metric had too few values. */
  points: Record<BenchmarkKey, number[]>;
};

/** The figure each scored part ranks. Loss-makers have no earnings yield and are left out of the valuation sample. */
export function benchmarkValue(key: BenchmarkKey, m: CompanyMetrics): number | null {
  const value = key === 'valuation' ? m.earningsYieldPct : key === 'growth' ? (m.epsYoYPct ?? m.epsAnnualCagrPct) : key === 'profitability' ? m.netMarginTrendPct : m.change1yPct;
  return value !== null && Number.isFinite(value) ? value : null;
}

function quantile(sorted: number[], q: number): number {
  const at = q * (sorted.length - 1);
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

export function buildBenchmarks(metricsList: CompanyMetrics[], computedOn: string): FactsBenchmarks | null {
  const usable = metricsList.filter((m) => !m.unavailable);
  if (usable.length < MIN_BENCHMARK_SAMPLE) return null;
  const points = {} as Record<BenchmarkKey, number[]>;
  for (const key of BENCHMARK_KEYS) {
    const values = usable
      .filter((m) => !(key === 'valuation' && ((m.epsTtm !== null && m.epsTtm <= 0) || (m.peTtm !== null && m.peTtm <= 0))))
      .map((m) => benchmarkValue(key, m))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);
    points[key] = values.length >= MIN_VALUES
      ? Array.from({ length: BENCHMARK_STEPS }, (_, i) => Math.round(quantile(values, i / (BENCHMARK_STEPS - 1)) * 100) / 100)
      : [];
  }
  return { computedOn, sample: usable.length, points };
}

/** Where a value sits among the market, 0 to 100 (below the lowest breakpoint is 0, above the highest is 100). */
export function rankAgainst(points: number[], value: number): number {
  if (!points.length) return 50;
  const last = points.length - 1;
  if (value <= points[0]) return 0;
  if (value >= points[last]) return 100;
  let i = 0;
  while (i < last && points[i + 1] < value) i++;
  const span = points[i + 1] - points[i];
  const within = span > 0 ? (value - points[i]) / span : 0;
  return Math.round(((i + within) / last) * 10_000) / 100;
}

/** Checks a stored or received row before it is trusted; null when it is not a usable set of breakpoints. */
export function parseBenchmarks(value: unknown, today: string): FactsBenchmarks | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<FactsBenchmarks>;
  if (typeof v.computedOn !== 'string' || !Number.isFinite(v.sample) || !v.points || typeof v.points !== 'object') return null;
  const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${v.computedOn}T00:00:00Z`)) / 86_400_000;
  if (!(age <= BENCHMARK_MAX_AGE_DAYS)) return null;
  const points = {} as Record<BenchmarkKey, number[]>;
  for (const key of BENCHMARK_KEYS) {
    const list = v.points[key];
    if (!Array.isArray(list) || !list.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    if (list.length && list.length !== BENCHMARK_STEPS) return null;
    points[key] = list;
  }
  return { computedOn: v.computedOn, sample: Number(v.sample), points };
}
