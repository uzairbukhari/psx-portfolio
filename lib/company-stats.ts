// Key statistics for the company page, from public data only (cached PSX company facts, payout announcements and
// face values). Anything we cannot support with data is null so the card shows a dash instead of an invented value.
import type { PayoutAnnouncement } from './psx-payouts.ts';

export type CompanyStats = {
  ticker: string;
  /** PSX price/earnings (trailing), as scraped. */
  peTtm: number | null;
  /** Market capitalisation in rupees. */
  marketCap: number | null;
  week52Low: number | null;
  week52High: number | null;
  /** Cash dividends (rupees per share) declared in the last 12 months; the page divides by its live price. */
  dividendPerShare12m: number | null;
};

const DAY = 86_400_000;

/**
 * Trailing 12 months of declared cash dividends, rupees per share. Payouts quoted in percent of face value need a
 * verified face value; without one the total is unknown rather than guessed. No payout in the window is a genuine 0.
 */
export function trailingDividendPerShare(
  announcements: Pick<
    PayoutAnnouncement,
    'kind' | 'percent' | 'perShareRs' | 'bookClosureStart'
  >[],
  faceValue: number | null,
  todayIso: string,
): number | null {
  const since = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 365 * DAY)
    .toISOString()
    .slice(0, 10);
  let perShare = 0;
  for (const a of announcements) {
    if (
      a.kind !== 'cash' ||
      a.bookClosureStart < since ||
      a.bookClosureStart > todayIso
    )
      continue;
    if (a.perShareRs !== null) perShare += a.perShareRs;
    else if (a.percent !== null) {
      if (!faceValue) return null;
      perShare += (a.percent / 100) * faceValue;
    }
  }
  return Math.round(perShare * 100) / 100;
}

/** 12.3M, 5.2B, 1.4T. Null shows as a dash. */
export function compactNumber(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const [div, suffix] =
    abs >= 1e12
      ? [1e12, 'T']
      : abs >= 1e9
        ? [1e9, 'B']
        : abs >= 1e6
          ? [1e6, 'M']
          : abs >= 1e3
            ? [1e3, 'K']
            : [1, ''];
  const v = n / div;
  return `${v.toFixed(suffix ? 1 : 0)}${suffix}`;
}
