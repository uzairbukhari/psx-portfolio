export type PayoutKind = 'cash' | 'bonus' | 'right';

export type PayoutAnnouncement = {
  ticker: string;
  /** PKT date the company announced the payout (YYYY-MM-DD). */
  announcedOn: string;
  /** Financial-results period as printed by PSX, e.g. "30/06/2026(HYR)"; empty when PSX shows "-". */
  period: string;
  /** Raw PSX details cell, e.g. "70%(F) (D)". */
  details: string;
  kind: PayoutKind;
  /** Percent of face value (cash and bonus). PSX prints a bare number for some rows. */
  percent: number | null;
  /** Rupees per share when PSX prints "Rs." instead of a percentage. */
  perShareRs: number | null;
  bookClosureStart: string;
  bookClosureEnd: string;
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const KINDS: Record<string, PayoutKind> = { D: 'cash', B: 'bonus', R: 'right' };

const text = (cell: string) =>
  cell
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** "August 6, 2026 3:37 PM" -> "2026-08-06". */
export function parseAnnouncedOn(s: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].toLowerCase());
  if (month < 0) return null;
  return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** "19/08/2026  - 20/08/2026" -> ISO start/end; a single date is both. */
export function parseBookClosure(s: string): { start: string; end: string } | null {
  const dates = [...s.matchAll(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g)].map(
    (m) => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
  );
  if (!dates.length) return null;
  for (const d of dates) if (new Date(d).toISOString().slice(0, 10) !== d) return null;
  return { start: dates[0], end: dates[dates.length - 1] };
}

/**
 * Splits a details cell into its payout components. PSX prints "70%(F) (D)"
 * (final cash), "80(ii) (D)" (interim, percent sign missing), "Rs.5 (D)" and
 * combined rows such as "25%(F) (D) 10%(B)". Each component is amount, an
 * optional (F)/(i)/(ii)/(iii) marker, then the kind letter.
 */
export function parseDetails(details: string) {
  const out: { kind: PayoutKind; percent: number | null; perShareRs: number | null }[] = [];
  const re =
    /(Rs\.?\s*)?(\d+(?:\.\d+)?)\s*(%)?\s*(?:\((?:F|i{1,3}|iv)\))?\s*\(([DBR])\)/gi;
  for (const m of details.matchAll(re)) {
    const amount = Number(m[2]);
    if (!Number.isFinite(amount)) continue;
    out.push({
      kind: KINDS[m[4].toUpperCase()],
      percent: m[1] ? null : amount,
      perShareRs: m[1] ? amount : null,
    });
  }
  return out;
}

/** Parses the fragment returned by POST dps.psx.com.pk/company/payouts. */
export function parsePayouts(html: string, ticker: string): PayoutAnnouncement[] {
  const out: PayoutAnnouncement[] = [];
  for (const row of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (cells.length < 4) continue;
    const announcedOn = parseAnnouncedOn(cells[0]);
    const closure = parseBookClosure(cells[3]);
    if (!announcedOn || !closure) continue;
    for (const part of parseDetails(cells[2]))
      out.push({
        ticker,
        announcedOn,
        period: cells[1] === '-' ? '' : cells[1],
        details: cells[2],
        bookClosureStart: closure.start,
        bookClosureEnd: closure.end,
        ...part,
      });
  }
  return out;
}
