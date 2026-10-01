import { positionTimeline, type Portfolio } from './portfolio.ts';

export type PricePoint = [number, number];
export type HistoryRange = 'today' | '7d' | '1m' | '1y';

const DAY = 86_400;
const RANGE_DAYS: Record<Exclude<HistoryRange, 'today'>, number> = { '7d': 7, '1m': 31, '1y': 366 };

/** Newest-first PSX eod rows -> chronological [sec, close] pairs, bad rows dropped. */
export function parseEod(rows: number[][]): PricePoint[] {
  return rows
    .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0)
    .map((r): PricePoint => [r[0], r[1]])
    .sort((a, b) => a[0] - b[0]);
}

/** Newest-first PSX intraday ticks -> chronological, downsampled to at most `limit` points. */
export function parseIntraday(rows: number[][], limit = 120): PricePoint[] {
  const points = rows
    .filter((r) => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0)
    .map((r): PricePoint => [r[0], r[1]])
    .sort((a, b) => a[0] - b[0]);
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => points[Math.round(i * step)]);
}

/** Slice a chronological series to a chart range ending at its last point. */
export function sliceRange(
  eod: PricePoint[],
  intraday: PricePoint[],
  range: HistoryRange,
): PricePoint[] {
  if (range === 'today') return intraday;
  const last = eod.at(-1)?.[0];
  if (last === undefined) return [];
  const from = last - RANGE_DAYS[range] * DAY;
  return eod.filter((p) => p[0] >= from);
}

export function rangeChange(points: PricePoint[]) {
  if (points.length < 2) return null;
  const first = points[0][1];
  const last = points[points.length - 1][1];
  return { change: last - first, percent: first ? ((last - first) / first) * 100 : 0 };
}

/** `cost`/`gain` are null on days a held position has an unknown opening cost. */
export type ValuePoint = { date: string; value: number; cost: number | null; gain: number | null };
export type ValueRange = '1m' | '1y' | 'all';

export const pktDate = (sec: number) => new Date((sec + 5 * 3600) * 1000).toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Rebuild the portfolio's market value, remaining cost and gain/loss per PSX trading day
 * from ledger positions and per-ticker daily closes (each carried forward over gaps).
 * Days before every held position can be priced are dropped; tickers with no history at
 * all are listed in `unpriced` and left out; tickers whose ledger sells more than was held
 * are listed in `inconsistent` (their positions are clamped at zero). `today` pins the final point to the live
 * card figures.
 */
export function portfolioValueSeries(
  p: Portfolio,
  eodByTicker: Record<string, PricePoint[]>,
  today?: ValuePoint,
): { points: ValuePoint[]; unpriced: string[]; inconsistent: string[] } {
  const live = p.trades.filter((t) => !t.voided);
  const start = live.map((t) => t.date).sort()[0];
  const unpriced: string[] = [];
  const priced: string[] = [];
  const inconsistent: string[] = [];
  const timelines = new Map<string, ReturnType<typeof positionTimeline>>();
  for (const t of new Set(live.map((x) => x.ticker))) {
    const timeline = positionTimeline(p, t);
    if (timeline.at(-1)?.oversold) inconsistent.push(t);
    if (eodByTicker[t]?.length) {
      priced.push(t);
      timelines.set(t, timeline);
    } else if ((timeline.at(-1)?.shares ?? 0) > 0) unpriced.push(t);
  }
  if (!start || !priced.length) return { points: today ? [today] : [], unpriced, inconsistent };

  const closes = new Map(
    priced.map((t) => [t, eodByTicker[t].map(([sec, c]): [string, number] => [pktDate(sec), c])]),
  );
  const days = Array.from(new Set([...closes.values()].flatMap((rows) => rows.map((r) => r[0]))))
    .filter((d) => d >= start)
    .sort();
  const cursor = new Map(priced.map((t) => [t, { ci: -1, ei: -1 }]));
  const points: ValuePoint[] = [];
  for (const day of days) {
    let value = 0;
    let cost: number | null = 0;
    let ready = true;
    for (const t of priced) {
      const c = cursor.get(t)!;
      const rows = closes.get(t)!;
      const timeline = timelines.get(t)!;
      while (c.ci + 1 < rows.length && rows[c.ci + 1][0] <= day) c.ci++;
      while (c.ei + 1 < timeline.length && timeline[c.ei + 1].date <= day) c.ei++;
      const pos = c.ei >= 0 ? timeline[c.ei] : undefined;
      if (!pos || pos.shares <= 0) continue;
      if (c.ci < 0) ready = false;
      else value += pos.shares * rows[c.ci][1];
      cost = cost === null || pos.cost === null ? null : cost + pos.cost;
    }
    if (!ready) continue;
    points.push({
      date: day,
      value: cents(value),
      cost: cost === null ? null : cents(cost),
      gain: cost === null ? null : cents(value - cost),
    });
  }
  if (today) {
    if (points.at(-1)?.date === today.date) points[points.length - 1] = today;
    else points.push(today);
  }
  return { points, unpriced, inconsistent };
}

export function sliceValueRange(points: ValuePoint[], range: ValueRange): ValuePoint[] {
  if (range === 'all' || !points.length) return points;
  const end = new Date(`${points[points.length - 1].date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - (range === '1m' ? 31 : 366));
  const from = end.toISOString().slice(0, 10);
  return points.filter((pt) => pt.date >= from);
}

/**
 * Day change from the previous close for quotes that have a price but no change
 * (the per-ticker price cache carries none, and the scraped summary may be a day old).
 * The previous close is the last eod close dated strictly before the quote's PKT date;
 * holidays and weekends simply fall back to the earlier trading day. Rows that already
 * have a change, have no price, or have no earlier close are returned untouched.
 */
export function fillChangeFromHistory<
  T extends {
    ticker: string;
    price: number | null;
    change: number | null;
    changePercent: number | null;
    previousClose: number | null;
  },
>(companies: T[], eod: Record<string, PricePoint[]>, quoteDates: Record<string, string | undefined>, today: string): T[] {
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return companies.map((company) => {
    if (company.price === null || company.change !== null) return company;
    const date = quoteDates[company.ticker] ?? today;
    let previous: number | null = null;
    let at = -Infinity;
    for (const [sec, close] of eod[company.ticker] ?? [])
      if (pktDate(sec) < date && close > 0 && sec > at) {
        previous = close;
        at = sec;
      }
    if (previous === null) return company;
    const change = round2(company.price - previous);
    return { ...company, change, changePercent: round2((change / previous) * 100), previousClose: previous };
  });
}
