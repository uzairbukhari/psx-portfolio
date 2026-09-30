/** Shared number formatting. Every figure in the UI goes through these so locale and rounding stay consistent. */
const LOCALE = 'en-PK';

const pkrFull = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'PKR',
  maximumFractionDigits: 2,
});
const sharesFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 });
const plainFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

const missing = (n: number | null | undefined): n is null | undefined =>
  n === null || n === undefined || !Number.isFinite(n);

/** Full PKR amount. Null means unknown, never zero. */
export function pkr(n: number | null | undefined): string {
  return missing(n) ? 'Unknown' : pkrFull.format(n);
}

function trim(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** Compact PKR using South-Asian units: lakh (1e5) and crore (1e7). */
export function pkrCompact(n: number | null | undefined): string {
  if (missing(n)) return 'Unknown';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}PKR ${trim(abs / 1e7)} crore`;
  if (abs >= 1e5) return `${sign}PKR ${trim(abs / 1e5)} lakh`;
  return pkr(n);
}

/** Percent with optional explicit sign. `value` is already a percentage (12.5 means 12.5%). */
export function pct(
  value: number | null | undefined,
  opts: { sign?: boolean; digits?: number } = {},
): string {
  if (missing(value)) return '—';
  const body = `${Math.abs(value).toFixed(opts.digits ?? 1)}%`;
  if (value < 0) return `−${body}`;
  return opts.sign && value > 0 ? `+${body}` : body;
}

/** Signed PKR amount for gains and losses. */
export function signedPkr(n: number | null | undefined): string {
  if (missing(n)) return 'Unknown';
  if (n === 0) return pkr(0);
  const body = pkrFull.format(Math.abs(n));
  return n < 0 ? `−${body}` : `+${body}`;
}

/** Share quantity with grouping. */
export function shares(n: number | null | undefined): string {
  return missing(n) ? '—' : sharesFmt.format(n);
}

/** Plain grouped number (index levels, counts). */
export function num(n: number | null | undefined): string {
  return missing(n) ? '—' : plainFmt.format(n);
}

/** Date-time in Pakistan time. */
export function pktDateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(LOCALE, {
        timeZone: 'Asia/Karachi',
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}
