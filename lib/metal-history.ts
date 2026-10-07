// Turns daily world-price history (USD per ounce) and the daily dollar rate into rupees-per-tola rows for `metal_rates`.
// Pure: used by scripts/metal-rates-backfill.mjs and its test.
import { tolaFromSpot, type Metal } from './metal-rates.ts';

export type DailyClose = { date: string; close: number };

/** Reads a Yahoo Finance chart response into dated closes, skipping days with no price. Throws on an unexpected shape. */
export function parseYahooChart(json: unknown): DailyClose[] {
  const result = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }
    | undefined;
  const times = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(times) || !Array.isArray(closes) || times.length !== closes.length)
    throw new Error('Unexpected Yahoo chart response shape.');
  const byDate = new Map<string, number>();
  times.forEach((t, i) => {
    const c = closes[i];
    if (typeof c === 'number' && c > 0)
      byDate.set(new Date(t * 1000).toISOString().slice(0, 10), c);
  });
  return [...byDate].map(([date, close]) => ({ date, close })).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export type BackfillRow = { date: string; metal: Metal; pkrPerTola: number };

/** One row per metal price day; the dollar rate is the latest one on or before that day (weekends and holidays carry forward). */
export function backfillRows(
  metal: Metal,
  prices: DailyClose[],
  fx: DailyClose[],
): BackfillRow[] {
  const rows: BackfillRow[] = [];
  let i = 0;
  let rate: number | null = null;
  for (const p of prices) {
    while (i < fx.length && fx[i].date <= p.date) rate = fx[i++].close;
    if (rate === null || !(rate > 100 && rate < 1000)) continue;
    rows.push({ date: p.date, metal, pkrPerTola: Math.round(tolaFromSpot(p.close, rate)) });
  }
  return rows;
}
