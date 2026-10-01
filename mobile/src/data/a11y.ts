// Plain-language strings for screen readers (no React / native imports so they can be tested with node).
import { money, moneyShort } from '../../../lib/portfolio.ts';

/** "gain of Rs 1,200" / "loss of Rs 300"; sign words, not "+" or "-" glyphs that readers skip or mispronounce. */
export function signedAmountLabel(value: number | null, format: (n: number) => string = moneyShort): string {
  if (value === null) return 'not available';
  if (value === 0) return 'no change';
  return `${value > 0 ? 'gain' : 'loss'} of ${format(Math.abs(value))}`;
}

/** Same for a percentage: "up 2.5 percent" / "down 1.2 percent". */
export function signedPercentLabel(value: number | null): string {
  if (value === null) return 'not available';
  if (value === 0) return 'unchanged';
  return `${value > 0 ? 'up' : 'down'} ${Math.abs(value).toFixed(2)} percent`;
}

/** Text alternative for a price/value chart: range, start, end and direction. */
export function chartSummary(points: [number, number][], label: string): string {
  if (points.length < 2) return `${label}: not enough data for a chart.`;
  const values = points.map((p) => p[1]);
  const first = values[0];
  const last = values[values.length - 1];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const trend = last === first ? 'unchanged' : last > first ? 'up' : 'down';
  const fmt = (n: number) => money(n);
  return `${label}: ${trend}, from ${fmt(first)} to ${fmt(last)}; low ${fmt(low)}, high ${fmt(high)}; ${points.length} points.`;
}
