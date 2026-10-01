// Activity list view-model: type filter, search and month sections (newest first). Pure.
import type { ActivityEntry } from './derive.ts';
import { MONTH_NAMES } from './calendar.ts';

export type ActivityFilter = 'all' | 'buy' | 'sell' | 'dividend' | 'split';
export const ACTIVITY_FILTERS: { key: ActivityFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'buy', label: 'Buys' },
  { key: 'sell', label: 'Sells' },
  { key: 'dividend', label: 'Dividends' },
  { key: 'split', label: 'Splits' },
];

export type ActivitySection = { key: string; title: string; data: ActivityEntry[] };

/** Opening balances count as buys. Search matches ticker, title, detail and date. */
export function filterActivity(entries: ActivityEntry[], filter: ActivityFilter, query: string): ActivityEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter !== 'all' && (filter === 'buy' ? e.kind !== 'buy' && e.kind !== 'opening' : e.kind !== filter)) return false;
    if (!q) return true;
    return `${e.ticker} ${e.title} ${e.detail} ${e.date}`.toLowerCase().includes(q);
  });
}

/** Month sections in the order the entries arrive (already newest first). */
export function groupByMonth(entries: ActivityEntry[]): ActivitySection[] {
  const sections: ActivitySection[] = [];
  for (const e of entries) {
    const key = e.date.slice(0, 7);
    let last = sections[sections.length - 1];
    if (!last || last.key !== key) {
      const [y, m] = key.split('-').map(Number);
      last = { key, title: MONTH_NAMES[m - 1] ? `${MONTH_NAMES[m - 1]} ${y}` : key, data: [] };
      sections.push(last);
    }
    last.data.push(e);
  }
  return sections;
}
