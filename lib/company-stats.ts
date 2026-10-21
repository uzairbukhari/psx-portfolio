// Key statistics for the company page, from public data only (cached PSX company facts, payout announcements and
// face values). Anything we cannot support with data is null so the card shows a dash instead of an invented value.
import type { PayoutAnnouncement } from './psx-payouts.ts';
import type { FaceValueEvidence } from './face-values.ts';

export type CompanyStats = {
  ticker: string;
  /** PSX price/earnings (trailing), as scraped. */
  peTtm: number | null;
  /** Market capitalisation in rupees. */
  marketCap: number | null;
  week52Low: number | null;
  week52High: number | null;
  /** Payouts announced in the last 13 months and the verified face values, so the page can work out the yield with its own face value and live price. */
  payouts: StatsPayout[];
  faceValues: FaceValueEvidence[];
};

const DAY = 86_400_000;

export type StatsPayout = Pick<
  PayoutAnnouncement,
  'kind' | 'percent' | 'perShareRs' | 'bookClosureStart'
>;

/**
 * Trailing 12 months of declared cash dividends, rupees per share. Payouts quoted in percent of face value need the
 * face value in force on that date (`faceValueAt`, the account's own value or verified evidence); without one the
 * total is unknown rather than guessed. No payout in the window is a genuine 0.
 */
export function trailingDividendPerShare(
  payouts: StatsPayout[],
  faceValueAt: (date: string) => number | null,
  todayIso: string,
): number | null {
  const since = new Date(Date.parse(`${todayIso}T00:00:00Z`) - 365 * DAY)
    .toISOString()
    .slice(0, 10);
  let perShare = 0;
  for (const a of payouts) {
    if (
      a.kind !== 'cash' ||
      a.bookClosureStart < since ||
      a.bookClosureStart > todayIso
    )
      continue;
    if (a.perShareRs !== null) perShare += a.perShareRs;
    else if (a.percent !== null) {
      const faceValue = faceValueAt(a.bookClosureStart);
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

/** The live day figures the key-statistics card needs; every field may be unknown. */
export type DayQuote = {
  high: number | null;
  low: number | null;
  volume: number | null;
  previousClose: number | null;
  price: number | null;
};

/** One label/value row of the key-statistics card. A null value is shown as a dash. */
export type StatRow = { label: string; value: number | null; format: 'rs' | 'compact' | 'ratio' | 'percent' };

/**
 * The key-statistics card, worked out from public data only: the live day quote, today's ticks, the cached PSX
 * company facts and the payout announcements. Shared by the web card and the phone so both show the same figures.
 * `company` is the account's own record (its explicit face value wins); pass undefined when the value is only assumed,
 * so an invented face value never feeds a published-looking yield.
 */
export function keyStats(o: {
  stats: CompanyStats | null;
  day: DayQuote | undefined;
  eod: readonly [number, number][];
  intraday: readonly [number, number][];
  company: { faceValue?: number } | undefined;
  faceValueAt: (company: { faceValue?: number } | undefined, evidence: FaceValueEvidence[] | undefined, date: string) => number | null;
  todayIso: string;
}): { left: StatRow[]; right: StatRow[] } {
  const { stats, day, eod, intraday, company, faceValueAt, todayIso } = o;
  // The first tick of the latest session is the opening print.
  const first = intraday[0];
  const last = intraday[intraday.length - 1];
  const open = first && last && pktDay(first[0]) === pktDay(last[0]) ? first[1] : null;
  // PSX's own 52-week range when scraped; otherwise the range of the last year's daily closes.
  const range = (() => {
    if (stats?.week52High != null && stats.week52Low != null) return { low: stats.week52Low, high: stats.week52High };
    const newest = eod[eod.length - 1];
    if (!newest) return { low: null, high: null };
    const closes = eod.filter(([t]) => t >= newest[0] - 365 * DAY_SECONDS).map(([, p]) => p);
    return closes.length ? { low: Math.min(...closes), high: Math.max(...closes) } : { low: null, high: null };
  })();
  const dps = stats ? trailingDividendPerShare(stats.payouts, (date) => faceValueAt(company, stats.faceValues, date), todayIso) : null;
  const price = day?.price ?? null;
  return {
    left: [
      { label: 'Open', value: open, format: 'rs' },
      { label: "Day's high", value: day?.high ?? null, format: 'rs' },
      { label: "Day's low", value: day?.low ?? null, format: 'rs' },
      { label: '52 wk high', value: range.high, format: 'rs' },
      { label: '52 wk low', value: range.low, format: 'rs' },
    ],
    right: [
      { label: 'Volume', value: day?.volume ?? null, format: 'compact' },
      { label: 'Market cap', value: stats?.marketCap ?? null, format: 'compact' },
      { label: 'PE ratio', value: stats?.peTtm ?? null, format: 'ratio' },
      { label: 'Dividend yield', value: dps !== null && price ? (dps / price) * 100 : null, format: 'percent' },
      { label: 'Prev. close', value: day?.previousClose ?? null, format: 'rs' },
    ],
  };
}

const DAY_SECONDS = 86_400;
const pktDay = (sec: number) => new Date((sec + 5 * 3600) * 1000).toISOString().slice(0, 10);

/** A stat row as text, the way both clients print it ("320.00", "2.4M", "8.00", "6.25%", "—"). */
export function formatStat(row: StatRow): string {
  if (row.value === null || !Number.isFinite(row.value)) return '—';
  switch (row.format) {
    case 'compact':
      return compactNumber(row.value);
    case 'ratio':
      return row.value.toFixed(2);
    case 'percent':
      return `${row.value.toFixed(2)}%`;
    default:
      return row.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
