// Display formatting shared by screens (pure). Gains and losses are always signed and use a true minus sign;
// colour is never the only signal (see the design spec's number language).
import { money, moneyShort } from '../../../lib/portfolio.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "+PKR 1,200" / "−PKR 300" (no sign at zero); `short` drops paise for big figures like the summary. */
export function signedMoney(value: number | null, short = true): string {
  if (value === null) return '—';
  const fmt = short ? moneyShort : money;
  if (value === 0) return fmt(0);
  return `${value > 0 ? '+' : '−'}${fmt(Math.abs(value))}`;
}

/** "+12.93%" / "−6.90%". */
export function signedPercent(value: number | null): string {
  if (value === null) return '—';
  if (value === 0) return '0.00%';
  return `${value > 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}%`;
}

/** "30 Sep" for a YYYY-MM-DD date (this year omits the year, other years show it). */
export function shortDate(iso: string | null, thisYear?: number): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const label = `${d} ${MONTHS[m - 1]}`;
  return thisYear !== undefined && y !== thisYear ? `${label} ${y}` : label;
}

/** "14:05" in Pakistan time for an ISO timestamp, or null when it cannot be read. */
export function pktTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const pkt = new Date(t.getTime() + 5 * 3_600_000);
  return `${String(pkt.getUTCHours()).padStart(2, '0')}:${String(pkt.getUTCMinutes()).padStart(2, '0')}`;
}

/** Month name for a YYYY-MM key, e.g. "October 2026". */
export function monthTitle(month: string, withYear = true): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Up PKR 12.30 (+4.20%) over one month" for a chart's visible summary; null when there is no change to report. */
export function changeSummary(c: { change: number; percent: number } | null, over: string): string | null {
  if (!c) return null;
  const verb = c.change === 0 ? 'Unchanged' : c.change > 0 ? 'Up' : 'Down';
  return c.change === 0 ? `Unchanged over ${over}` : `${verb} ${money(Math.abs(c.change))} (${signedPercent(c.percent)}) over ${over}`;
}
