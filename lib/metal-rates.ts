// Gold and silver prices in rupees, and the weights coins and bars come in. Pure: shared by web, phone and the scraper.
//
// Two kinds of rate are stored. `local` is what Pakistani bullion dealers quote (what you would really be paid);
// `international` is the world spot price converted to rupees, used only when the local rate is out of date.
// A rate is always the price of 24K (pure) metal per tola; other purities are scaled from it.

export const TOLA_GRAMS = 11.6638;
export const OUNCE_GRAMS = 31.1035;
export type Metal = 'gold' | 'silver';
export type RateKind = 'local' | 'international';
export const KARATS = [24, 22, 21, 18] as const;
export type Karat = (typeof KARATS)[number];

export type MetalRateRow = {
  /** PKT date the rate was taken. */
  date: string;
  metal: Metal;
  kind: RateKind;
  /** Rupees per tola of pure (24K) metal. */
  pkrPerTola: number;
  sourceUrl: string;
  sourceLabel?: string;
  fetchedAt: string;
};

/** Standard coin and bar sizes offered in the entry form; any other weight can be typed in grams. */
export const STANDARD_PIECES: { label: string; grams: number }[] = [
  { label: '1 g', grams: 1 },
  { label: '2.5 g', grams: 2.5 },
  { label: '5 g', grams: 5 },
  { label: '10 g', grams: 10 },
  { label: '1/2 tola', grams: TOLA_GRAMS / 2 },
  { label: '1 tola', grams: TOLA_GRAMS },
  { label: '2 tola', grams: TOLA_GRAMS * 2 },
  { label: '5 tola', grams: TOLA_GRAMS * 5 },
  { label: '10 tola', grams: TOLA_GRAMS * 10 },
  { label: '1 oz', grams: OUNCE_GRAMS },
  { label: '50 g', grams: 50 },
  { label: '100 g', grams: 100 },
  { label: '1 kg', grams: 1000 },
];

export const gramsFromTola = (tola: number) => tola * TOLA_GRAMS;
export const tolaFromGrams = (grams: number) => grams / TOLA_GRAMS;
export const purity = (karat: Karat) => karat / 24;

/** A rate this old is still shown, but flagged. */
export const LOCAL_FRESH_DAYS = 2;
export const STALE_DAYS = 7;
const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round(dayNumber(to) - dayNumber(from));

export type ChosenRate = {
  metal: Metal;
  kind: RateKind;
  date: string;
  pkrPerTola: number;
  /** Rupees per gram of 24K metal. */
  pkrPerGram: number;
  sourceUrl: string;
  /** Older than a week. */
  stale: boolean;
  /** True when a local rate exists but is too old and the international estimate was used instead. */
  fellBack: boolean;
};

const valid = (row: MetalRateRow) =>
  Number.isFinite(row.pkrPerTola) &&
  row.pkrPerTola > 0 &&
  /^\d{4}-\d{2}-\d{2}$/.test(row.date);

/** The newest local rate if it is at most two days old, otherwise the newest international one, otherwise the newest local. */
export function chooseRate(
  rows: MetalRateRow[],
  metal: Metal,
  asOf: string,
): ChosenRate | null {
  const mine = rows.filter(
    (r) => r.metal === metal && valid(r) && r.date <= asOf,
  );
  const newest = (kind: RateKind) =>
    mine
      .filter((r) => r.kind === kind)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  const local = newest('local');
  const international = newest('international');
  const localFresh = local && daysBetween(local.date, asOf) <= LOCAL_FRESH_DAYS;
  const picked = localFresh ? local : (international ?? local);
  if (!picked) return null;
  return {
    metal,
    kind: picked.kind,
    date: picked.date,
    pkrPerTola: picked.pkrPerTola,
    pkrPerGram: picked.pkrPerTola / TOLA_GRAMS,
    sourceUrl: picked.sourceUrl,
    stale: daysBetween(picked.date, asOf) > STALE_DAYS,
    fellBack: !!local && !localFresh && picked.kind === 'international',
  };
}

/** Rupees per tola from a world price in USD per troy ounce and the dollar rate. */
export const tolaFromSpot = (usdPerOunce: number, pkrPerUsd: number) =>
  (usdPerOunce * pkrPerUsd * TOLA_GRAMS) / OUNCE_GRAMS;

const num = (text: string) => Number(text.replace(/[^0-9.]/g, ''));

/**
 * Reads the 24K gold price per tola (and per 10 g, as a cross-check) from the text of a dealer rate page such as
 * gold.pk. Returns null unless both numbers are present and agree (a tola is 1.16638 times ten grams), so a
 * redesigned page fails loudly instead of storing a wrong price.
 */
export function parseGoldPage(html: string): { pkrPerTola: number } | null {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  // gold.pk labels its rates "24 Karat Gold Rate (1 Tola)" and "(10 Gram)" with the amount beside the label (the older
  // layout read "24K ... per Tola Rs ..."). The amount may sit just after or just before its label, so collect both
  // and keep the one pair whose tola and 10-gram prices agree with each other.
  const amounts = (label: RegExp): number[] => {
    const m = label.exec(text);
    if (!m) return [];
    const rs = () => /Rs\.?\s*([\d,]+(?:\.\d+)?)/gi;
    const end = m.index + m[0].length;
    const after = rs().exec(text.slice(end, end + 60));
    const before = [
      ...text.slice(Math.max(0, m.index - 60), m.index).matchAll(rs()),
    ].at(-1);
    return [after?.[1], before?.[1]].flatMap((x) => (x ? [num(x)] : []));
  };
  const tolas = amounts(
    /24\s*K(?:arat)?\s*(?:Gold\s*)?(?:Rate\s*)?\(?\s*(?:per\s*|1\s*)Tola\s*\)?/i,
  );
  const tens = amounts(
    /24\s*K(?:arat)?\s*(?:Gold\s*)?(?:Rate\s*)?\(?\s*(?:per\s*)?10\s*Gram(?:s)?\s*\)?/i,
  );
  for (const perTola of tolas) {
    if (!(perTola > 50_000 && perTola < 5_000_000)) continue;
    for (const perTen of tens) {
      const expected = (perTen * TOLA_GRAMS) / 10;
      if (Math.abs(expected - perTola) / perTola <= 0.01)
        return { pkrPerTola: perTola };
    }
  }
  return null;
}
