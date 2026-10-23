// Foreign currency rates in rupees (USD, AED, SAR). Pure: shared by web, phone and the scrapers.
//
// Two kinds of rate are stored. `open_market` is what exchange companies pay for cash (what you would really get);
// `interbank` is the mid-market reference converted to rupees, used when the open-market rate is out of date.

export const SUPPORTED_CURRENCIES = ['USD', 'AED', 'SAR'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];
export type FxKind = 'open_market' | 'interbank';
export const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  USD: 'US dollar',
  AED: 'UAE dirham',
  SAR: 'Saudi riyal',
};
/** Units of the currency per US dollar. The dirham and the riyal are fixed to the dollar, which the scrapers use as a check. */
export const DOLLAR_PEGS: Partial<Record<CurrencyCode, number>> = {
  AED: 3.6725,
  SAR: 3.75,
};

export type FxRateRow = {
  /** PKT date the rate was taken. */
  date: string;
  currency: CurrencyCode;
  kind: FxKind;
  /** Rupees for one unit of the currency. */
  pkrPerUnit: number;
  sourceUrl: string;
  sourceLabel?: string;
  fetchedAt: string;
};

export const OPEN_FRESH_DAYS = 2;
export const STALE_DAYS = 7;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round(dayNumber(to) - dayNumber(from));

export const isCurrencyCode = (value: unknown): value is CurrencyCode =>
  typeof value === 'string' &&
  (SUPPORTED_CURRENCIES as readonly string[]).includes(value);

export type ChosenFxRate = {
  currency: CurrencyCode;
  kind: FxKind;
  date: string;
  pkrPerUnit: number;
  sourceUrl: string;
  /** Older than a week. */
  stale: boolean;
  /** True when an open-market rate exists but is too old and the interbank estimate was used instead. */
  fellBack: boolean;
};

const valid = (row: FxRateRow) =>
  Number.isFinite(row.pkrPerUnit) && row.pkrPerUnit > 0 && DATE.test(row.date);

/** The newest open-market rate if it is at most two days old, otherwise the newest interbank one, otherwise the newest open-market. */
export function chooseFxRate(
  rows: FxRateRow[],
  currency: CurrencyCode,
  asOf: string,
): ChosenFxRate | null {
  const mine = rows.filter(
    (r) => r.currency === currency && valid(r) && r.date <= asOf,
  );
  const newest = (kind: FxKind) =>
    mine
      .filter((r) => r.kind === kind)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  const open = newest('open_market');
  const interbank = newest('interbank');
  const openFresh = open && daysBetween(open.date, asOf) <= OPEN_FRESH_DAYS;
  const picked = openFresh ? open : (interbank ?? open);
  if (!picked) return null;
  return {
    currency,
    kind: picked.kind,
    date: picked.date,
    pkrPerUnit: picked.pkrPerUnit,
    sourceUrl: picked.sourceUrl,
    stale: daysBetween(picked.date, asOf) > STALE_DAYS,
    fellBack: !!open && !openFresh && picked.kind === 'interbank',
  };
}

export type DollarRates = { PKR: number; AED: number; SAR: number };

/** Reads the rates-per-dollar answer of open.er-api.com. Returns null unless the rupee is plausible and the dirham and riyal sit at their pegs. */
export function parseDollarRates(json: unknown): DollarRates | null {
  const rates = (json as { rates?: Record<string, unknown> } | null)?.rates;
  if (!rates) return null;
  const { PKR, AED, SAR } = rates;
  if (typeof PKR !== 'number' || !(PKR > 100 && PKR < 1000)) return null;
  for (const [code, value] of [
    ['AED', AED],
    ['SAR', SAR],
  ] as const) {
    const peg = DOLLAR_PEGS[code]!;
    if (typeof value !== 'number' || Math.abs(value - peg) / peg > 0.01)
      return null;
  }
  return { PKR, AED: AED as number, SAR: SAR as number };
}

/** Rupees per unit for each supported currency from the per-dollar rates. */
export function interbankFromDollar(
  r: DollarRates,
): Record<CurrencyCode, number> {
  return { USD: r.PKR, AED: r.PKR / r.AED, SAR: r.PKR / r.SAR };
}

const NAME_PATTERNS: Record<CurrencyCode, RegExp> = {
  USD: /U\.?S\.?\s*Dollar|USD/i,
  AED: /U\.?A\.?E\.?\s*Dirham|\bAED\b/i,
  SAR: /Saudi\s*Riyal|\bSAR\b/i,
};

/**
 * The page is https://www.forex.pk/open_market_rates.asp (underscores; the hyphenated address answers 404).
 * Reads the open-market table of a rates page (buying then selling, in rupees) from its text. Each currency must
 * have a buying rate that is not above its selling rate and within 3% of the interbank rate, or the whole page is
 * rejected, so a redesigned page fails loudly instead of storing a wrong rate. Returns the buying rate.
 */
export function parseOpenMarketPage(
  html: string,
  interbank: Record<CurrencyCode, number>,
): Record<CurrencyCode, number> | null {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const out = {} as Record<CurrencyCode, number>;
  for (const code of SUPPORTED_CURRENCIES) {
    const reference = interbank[code];
    const label = NAME_PATTERNS[code];
    let found: number | null = null;
    for (const m of text.matchAll(new RegExp(label.source, 'gi'))) {
      const numbers = [
        ...text
          .slice(m.index + m[0].length, m.index + m[0].length + 80)
          .matchAll(/\d{1,4}(?:\.\d+)?/g),
      ].map((x) => Number(x[0]));
      for (let i = 0; i + 1 < numbers.length; i++) {
        const [buy, sell] = [numbers[i], numbers[i + 1]];
        if (
          buy <= sell &&
          Math.abs(buy - reference) / reference <= 0.03 &&
          Math.abs(sell - reference) / reference <= 0.05
        ) {
          found = buy;
          break;
        }
      }
      if (found !== null) break;
    }
    if (found === null) return null;
    out[code] = found;
  }
  return out;
}

export type DailyRate = { date: string; rate: number };
/** One packed row: every rate of a currency and kind for one year, stored as JSON text so the whole history is a few rows to read. */
export type PackedYear = {
  currency: CurrencyCode;
  kind: FxKind;
  year: string;
  closes: string;
};

export const packYears = (
  currency: CurrencyCode,
  kind: FxKind,
  rates: DailyRate[],
): PackedYear[] => {
  const byYear = new Map<string, DailyRate[]>();
  for (const r of [...rates].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const year = r.date.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), r]);
  }
  return [...byYear].map(([year, list]) => ({
    currency,
    kind,
    year,
    closes: JSON.stringify(
      list.map((r) => [r.date, Math.round(r.rate * 10_000) / 10_000]),
    ),
  }));
};

/** Merges a day's rate into an existing packed year (a later value for the same date wins). */
export function mergeYear(closes: string | null, today: DailyRate): string {
  let list: [string, number][] = [];
  try {
    const parsed = closes ? JSON.parse(closes) : [];
    if (Array.isArray(parsed))
      list = parsed.filter(
        (p) =>
          Array.isArray(p) &&
          typeof p[0] === 'string' &&
          typeof p[1] === 'number',
      );
  } catch {
    list = [];
  }
  const map = new Map(list);
  map.set(today.date, Math.round(today.rate * 10_000) / 10_000);
  return JSON.stringify([...map].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

/** Reads packed years back into rows (client side; never unpacked in SQL, so D1 counts one row per year). */
export function unpackYears(
  packed: { currency: string; kind: string; closes: string }[],
): { currency: CurrencyCode; kind: FxKind; date: string; rate: number }[] {
  const out: {
    currency: CurrencyCode;
    kind: FxKind;
    date: string;
    rate: number;
  }[] = [];
  for (const p of packed) {
    if (
      !isCurrencyCode(p.currency) ||
      (p.kind !== 'open_market' && p.kind !== 'interbank')
    )
      continue;
    let list: unknown;
    try {
      list = JSON.parse(p.closes);
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const item of list)
      if (
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        DATE.test(item[0]) &&
        typeof item[1] === 'number' &&
        item[1] > 0
      )
        out.push({
          currency: p.currency,
          kind: p.kind,
          date: item[0],
          rate: item[1],
        });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The recent rates and the stored history as one list, so a rate can be found for any past day (the recent ones win on the same day). */
export function fxRowsWithHistory(data: FxRatesResponse): FxRateRow[] {
  const seen = new Set(data.rates.map((r) => `${r.currency}|${r.kind}|${r.date}`));
  const old = data.history
    .filter((h) => !seen.has(`${h.currency}|${h.kind}|${h.date}`))
    .map((h): FxRateRow => ({ date: h.date, currency: h.currency, kind: h.kind, pkrPerUnit: h.rate, sourceUrl: '', fetchedAt: '' }));
  return [...old, ...data.rates];
}

export type FxRatesResponse = {
  rates: FxRateRow[];
  history: {
    currency: CurrencyCode;
    kind: FxKind;
    date: string;
    rate: number;
  }[];
};
