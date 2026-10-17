// Foreign currency held as cash or in a foreign currency account, tracked in rupees. Pure and self-contained so the
// ledger can validate it without a cycle (imports only the shared rate types).
//
// Like gold, every entry is dated and never overwritten. Selling removes units at the average rupee cost immediately
// before the sale, so the realised gain (or loss, from the rupee moving) is recorded on that sale. An unknown cost
// stays unknown, never zero.
import {
  chooseFxRate,
  isCurrencyCode,
  type ChosenFxRate,
  type CurrencyCode,
  type FxRateRow,
} from './fx-rates.ts';

export type CurrencyEntry = {
  id: string;
  date: string;
  type: 'opening' | 'buy' | 'sell';
  /** Amount of foreign currency, for example 500 for five hundred dollars. */
  units: number;
  /** Rupees paid (buy) or received (sell), fees included. Null only on an opening balance with unknown cost. */
  pkr: number | null;
  note: string;
  voided?: boolean;
};
export type CurrencyAsset = {
  id: string;
  kind: 'currency';
  name: string;
  currency: CurrencyCode;
  /** Where it is kept, for display only. */
  heldAt?: 'cash' | 'bank';
  note: string;
  entries: CurrencyEntry[];
};

export const MAX_CURRENCY_ENTRIES = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const units4 = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

// Same-day entries: opening first, then purchases, then sales.
const rank = (e: CurrencyEntry) =>
  e.type === 'opening' ? 0 : e.type === 'buy' ? 1 : 2;
const order = (entries: CurrencyEntry[]) =>
  entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.voided)
    .sort((a, b) =>
      a.entry.date === b.entry.date
        ? rank(a.entry) - rank(b.entry) || a.index - b.index
        : a.entry.date < b.entry.date
          ? -1
          : 1,
    )
    .map(({ entry }) => entry);

export type CurrencyPosition = {
  units: number;
  /** Remaining rupee cost; null while an opening balance has no cost. */
  cost: number | null;
  averageRate: number | null;
  /** Gain on what is sold so far (null when a sold lot had unknown cost). */
  realized: number | null;
  bought: { units: number; pkr: number };
  sold: { units: number; pkr: number };
  /** Entry-by-entry history, oldest first, with the units held after each. */
  history: (CurrencyEntry & {
    heldAfter: number;
    realizedGain: number | null;
  })[];
};

export function currencyPosition(asset: CurrencyAsset): CurrencyPosition {
  let units = 0;
  let cost: number | null = 0;
  let realized: number | null = 0;
  const bought = { units: 0, pkr: 0 };
  const sold = { units: 0, pkr: 0 };
  const history: CurrencyPosition['history'] = [];
  for (const entry of order(asset.entries)) {
    let realizedGain: number | null = null;
    if (entry.type === 'sell') {
      if (entry.units > units + 1e-9)
        throw new Error(
          `${asset.name}: a sale of ${entry.units} ${asset.currency} on ${entry.date} exceeds the ${units4(units)} ${asset.currency} held.`,
        );
      const average: number | null =
        cost === null ? null : units ? cost / units : 0;
      realizedGain =
        average === null || entry.pkr === null
          ? null
          : cents(entry.pkr - average * entry.units);
      if (realizedGain === null) realized = null;
      else if (realized !== null) realized += realizedGain;
      cost =
        average === null ? null : Math.max(0, cost! - average * entry.units);
      units -= entry.units;
      if (units < 1e-9) {
        units = 0;
        cost = 0;
      }
      sold.units += entry.units;
      sold.pkr += entry.pkr ?? 0;
    } else {
      units += entry.units;
      cost = cost === null || entry.pkr === null ? null : cost + entry.pkr;
      if (entry.type === 'buy') {
        bought.units += entry.units;
        bought.pkr += entry.pkr ?? 0;
      }
    }
    history.push({ ...entry, heldAfter: units4(units), realizedGain });
  }
  return {
    units: units4(units),
    cost: cost === null ? null : cents(cost),
    averageRate: cost === null || !units ? null : cost / units,
    realized: realized === null ? null : cents(realized),
    bought: { units: units4(bought.units), pkr: cents(bought.pkr) },
    sold: { units: units4(sold.units), pkr: cents(sold.pkr) },
    history,
  };
}

export type CurrencyValuation = CurrencyPosition & {
  rate: ChosenFxRate | null;
  /** Units × today's rate in rupees; null when there is no rate at all. */
  value: number | null;
  gain: number | null;
  gainPercent: number | null;
};

export function valueCurrency(
  asset: CurrencyAsset,
  rates: FxRateRow[],
  asOf: string,
): CurrencyValuation {
  const position = currencyPosition(asset);
  const rate = chooseFxRate(rates, asset.currency, asOf);
  const value =
    position.units === 0
      ? 0
      : rate
        ? cents(position.units * rate.pkrPerUnit)
        : null;
  const gain =
    value === null || position.cost === null
      ? null
      : cents(value - position.cost);
  return {
    ...position,
    rate,
    value,
    gain,
    gainPercent:
      gain !== null && position.cost ? (gain / position.cost) * 100 : null,
  };
}

/** Money paid in is positive, money received from a sale is negative; the investor view the return maths expects. */
export function currencyFlows(
  asset: CurrencyAsset,
): { date: string; amount: number }[] {
  return order(asset.entries)
    .filter((e) => e.pkr !== null)
    .map((e) => ({
      date: e.date,
      amount: e.type === 'sell' ? -e.pkr! : e.pkr!,
    }));
}

export const currencyUnknownCost = (asset: CurrencyAsset) =>
  order(asset.entries).some((e) => e.type !== 'sell' && e.pkr === null);

/** Throws with a plain message when the holding cannot be saved. Called by `validateAssets`. */
export function validateCurrency(a: CurrencyAsset, today: string): void {
  if (!isCurrencyCode(a.currency))
    throw new Error('Choose US dollar, UAE dirham or Saudi riyal.');
  if (a.heldAt !== undefined && a.heldAt !== 'cash' && a.heldAt !== 'bank')
    throw new Error('Invalid place.');
  if (!Array.isArray(a.entries) || a.entries.length > MAX_CURRENCY_ENTRIES)
    throw new Error('Invalid currency entries.');
  const entryIds = new Set<string>();
  for (const e of a.entries) {
    if (!e || typeof e.id !== 'string' || !e.id || entryIds.has(e.id))
      throw new Error('Invalid currency entry identifier.');
    entryIds.add(e.id);
    if (!['opening', 'buy', 'sell'].includes(e.type))
      throw new Error('Invalid currency entry type.');
    if (typeof e.date !== 'string' || !DATE.test(e.date) || e.date > today)
      throw new Error(
        'Currency entry dates must be real dates that are not in the future.',
      );
    if (!Number.isFinite(e.units) || e.units <= 0 || e.units > 1e9)
      throw new Error('Enter an amount greater than zero.');
    if (
      e.pkr !== null &&
      (!Number.isFinite(e.pkr) || e.pkr < 0 || e.pkr > 1e12)
    )
      throw new Error('Enter a valid amount in rupees.');
    if (e.pkr === null && e.type !== 'opening')
      throw new Error('Only an opening balance may have an unknown cost.');
    if (typeof e.note !== 'string' || e.note.length > 500)
      throw new Error('Entry note is too long.');
  }
  currencyPosition(a); // throws when a sale exceeds the units held
}
