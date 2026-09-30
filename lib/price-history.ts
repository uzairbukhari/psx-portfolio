import { sharesHeldOn, type Portfolio } from './portfolio.ts';

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

export type ValuePoint = { date: string; value: number };
export type ValueRange = '1m' | '1y' | 'all';

const pktDate = (sec: number) => new Date((sec + 5 * 3600) * 1000).toISOString().slice(0, 10);

/**
 * Rebuild the portfolio's market value per PSX trading day from ledger share counts and
 * per-ticker daily closes (each carried forward over gaps). Days before every held
 * position can be priced are dropped; tickers with no history at all are listed in
 * `unpriced` and left out. `today` pins the final point to the live card value.
 */
export function portfolioValueSeries(
  p: Portfolio,
  eodByTicker: Record<string, PricePoint[]>,
  today?: ValuePoint,
): { points: ValuePoint[]; unpriced: string[] } {
  const tickers = Array.from(new Set(p.trades.filter((t) => !t.voided).map((t) => t.ticker)));
  const start = p.trades.filter((t) => !t.voided).map((t) => t.date).sort()[0];
  const unpriced: string[] = [];
  const priced = tickers.filter((t) => {
    if (eodByTicker[t]?.length) return true;
    if (sharesHeldOn(p, t, '9999-12-31') > 0) unpriced.push(t);
    return false;
  });
  if (!start || !priced.length) return { points: today ? [today] : [], unpriced };

  const closes = new Map(
    priced.map((t) => [t, eodByTicker[t].map(([sec, c]): [string, number] => [pktDate(sec), c])]),
  );
  const days = Array.from(new Set([...closes.values()].flatMap((rows) => rows.map((r) => r[0]))))
    .filter((d) => d >= start)
    .sort();
  const eventDates = new Map(
    priced.map((t) => [
      t,
      Array.from(
        new Set([
          ...p.trades.filter((x) => x.ticker === t && !x.voided).map((x) => x.date),
          ...(p.stockSplits ?? []).filter((x) => x.ticker === t && !x.voided).map((x) => x.date),
        ]),
      ).sort(),
    ]),
  );
  const state = new Map(priced.map((t) => [t, { ci: -1, ei: 0, shares: 0 }]));
  const points: ValuePoint[] = [];
  for (const day of days) {
    let total = 0;
    let ready = true;
    for (const t of priced) {
      const s = state.get(t)!;
      const rows = closes.get(t)!;
      while (s.ci + 1 < rows.length && rows[s.ci + 1][0] <= day) s.ci++;
      const dates = eventDates.get(t)!;
      let moved = false;
      while (s.ei < dates.length && dates[s.ei] <= day) {
        s.ei++;
        moved = true;
      }
      if (moved) s.shares = sharesHeldOn(p, t, day);
      if (s.shares <= 0) continue;
      if (s.ci < 0) ready = false;
      else total += s.shares * rows[s.ci][1];
    }
    if (ready) points.push({ date: day, value: Math.round(total * 100) / 100 });
  }
  if (today) {
    if (points.at(-1)?.date === today.date) points[points.length - 1] = today;
    else points.push(today);
  }
  return { points, unpriced };
}

export function sliceValueRange(points: ValuePoint[], range: ValueRange): ValuePoint[] {
  if (range === 'all' || !points.length) return points;
  const end = new Date(`${points[points.length - 1].date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - (range === '1m' ? 31 : 366));
  const from = end.toISOString().slice(0, 10);
  return points.filter((pt) => pt.date >= from);
}
