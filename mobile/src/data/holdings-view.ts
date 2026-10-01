// Holdings list view-model (pure): sorting, sector filter and the per-row stale / expected chips.
import { lastTradingDay } from '../../../lib/psx-calendar.ts';
import { taxSummary, type Portfolio } from '../../../lib/portfolio.ts';
import type { Holding } from './derive.ts';

export type HoldingSort = 'value' | 'gain' | 'weight' | 'name';
export const HOLDING_SORTS: { key: HoldingSort; label: string; hint: string }[] = [
  { key: 'value', label: 'Value', hint: 'Largest market value first' },
  { key: 'gain', label: 'Gain', hint: 'Biggest unrealised gain, in percent, first' },
  { key: 'weight', label: 'Weight', hint: 'Largest share of the portfolio first' },
  { key: 'name', label: 'Name', hint: 'A to Z by ticker' },
];

const gainPercent = (h: Holding) => (h.gain === null || !h.cost ? null : (h.gain / h.cost) * 100);

/** Share of the priced portfolio value (0..100); null when the holding has no price. */
export function weightOf(h: Holding, total: number): number | null {
  return h.value === null || total <= 0 ? null : (h.value / total) * 100;
}

/** Open positions in the chosen order; companies with no price or gain always sort after those that have one. */
export function sortHoldings(open: Holding[], sort: HoldingSort): Holding[] {
  const total = open.reduce((a, h) => a + (h.value ?? 0), 0);
  const key = (h: Holding): number | null => (sort === 'value' ? h.value : sort === 'gain' ? gainPercent(h) : sort === 'weight' ? weightOf(h, total) : null);
  return [...open].sort((a, b) => {
    if (sort === 'name') return a.ticker.localeCompare(b.ticker);
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb === null) return a.ticker.localeCompare(b.ticker);
    if (ka === null) return 1;
    if (kb === null) return -1;
    return kb - ka || a.ticker.localeCompare(b.ticker);
  });
}

/** Sectors present among the positions, A to Z. */
export function sectorsOf(open: Holding[]): string[] {
  return [...new Set(open.map((h) => h.sector).filter(Boolean))].sort();
}

export const filterBySector = (open: Holding[], sector: string | null): Holding[] => (sector ? open.filter((h) => h.sector === sector) : open);

export type HoldingFlags = { stale: boolean; expectedDividend: boolean };

/** Which holdings have a quote older than the last trading day, and which have an expected (unconfirmed) dividend. */
export function holdingFlags(p: Portfolio, open: Holding[], now: string): Map<string, HoldingFlags> {
  const last = lastTradingDay(now);
  let expected = new Set<string>();
  try {
    expected = new Set(taxSummary(p).dividends.filter((d) => d.status === 'expected').map((d) => d.ticker));
  } catch {
    // ignore: a broken ledger is reported by the screen
  }
  return new Map(open.map((h) => [h.ticker, { stale: Boolean(h.quote) && h.quote!.date < last, expectedDividend: expected.has(h.ticker) }]));
}

/** "4 of 5 priced · oldest price 26 Sep" style line, or null when there is nothing to say. */
export function pricedLine(open: Holding[], oldest: string | null, formatDate: (iso: string) => string): string | null {
  if (!open.length) return null;
  const priced = open.filter((h) => h.value !== null).length;
  return `${priced} of ${open.length} priced${oldest ? ` · oldest price ${formatDate(oldest)}` : ''}`;
}
