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
