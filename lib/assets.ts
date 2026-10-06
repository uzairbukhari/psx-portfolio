// Other assets kept inside a portfolio: gold and silver coins and bars today; savings plans and mutual funds follow in
// later releases. Pure and self-contained (no imports from portfolio.ts) so the ledger can validate it without a cycle.
//
// Every entry is dated and never overwritten. Selling removes grams at the average cost immediately before the sale
// (the same rule stocks use), so realised gain is recorded on that sale. An unknown cost stays unknown, never zero.
import {
  chooseRate,
  purity,
  TOLA_GRAMS,
  type ChosenRate,
  type Karat,
  type Metal,
  type MetalRateRow,
} from './metal-rates.ts';
import {
  fundFlows,
  fundUnknownCost,
  validateFund,
  valueFund,
  type FundAsset,
} from './funds.ts';
import type { FundNavRow } from './mufap.ts';
import {
  planFlows,
  planValue,
  validatePlan,
  type PlanAsset,
  type PlanNavRow,
} from './plans.ts';

export type MetalEntry = {
  id: string;
  date: string;
  type: 'opening' | 'buy' | 'sell';
  /** Total weight of this entry in grams. */
  grams: number;
  /** Optional: how many pieces and what each weighs, for display ("3 × 1 tola"). */
  pieces?: number;
  pieceGrams?: number;
  form?: 'coin' | 'bar';
  /** Rupees paid (buy) or received (sell), premium and fees included. Null only on an opening balance with unknown cost. */
  amount: number | null;
  note: string;
  voided?: boolean;
};
export type MetalAsset = {
  id: string;
  kind: 'metal';
  name: string;
  metal: Metal;
  karat: Karat;
  note: string;
  entries: MetalEntry[];
};
export type Asset = MetalAsset | PlanAsset | FundAsset;

export const MAX_ASSETS = 200;
export const MAX_ENTRIES = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const grams3 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;

export type MetalPosition = {
  grams: number;
  /** Remaining cost; null while an opening balance has no cost. */
  cost: number | null;
  averagePerGram: number | null;
  /** Gain on what is sold so far (null when a sold lot had unknown cost). */
  realized: number | null;
  bought: { grams: number; amount: number };
  sold: { grams: number; amount: number };
  /** Entry-by-entry history, oldest first, with the grams held after each. */
  history: (MetalEntry & { heldAfter: number; realizedGain: number | null })[];
};

const order = (entries: MetalEntry[]) =>
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
// Same-day entries: opening first, then purchases, then sales.
const rank = (e: MetalEntry) =>
  e.type === 'opening' ? 0 : e.type === 'buy' ? 1 : 2;

export function metalPosition(asset: MetalAsset): MetalPosition {
  let grams = 0;
  let cost: number | null = 0;
  let realized: number | null = 0;
  const bought = { grams: 0, amount: 0 };
  const sold = { grams: 0, amount: 0 };
  const history: MetalPosition['history'] = [];
  for (const entry of order(asset.entries)) {
    let realizedGain: number | null = null;
    if (entry.type === 'sell') {
      if (entry.grams > grams + 1e-9)
        throw new Error(
          `${asset.name}: a sale of ${entry.grams} g on ${entry.date} exceeds the ${grams3(grams)} g held.`,
        );
      const average: number | null =
        cost === null ? null : grams ? cost / grams : 0;
      realizedGain =
        average === null || entry.amount === null
          ? null
          : cents(entry.amount - average * entry.grams);
      if (realizedGain === null) realized = null;
      else if (realized !== null) realized += realizedGain;
      cost =
        average === null ? null : Math.max(0, cost! - average * entry.grams);
      grams -= entry.grams;
      if (grams < 1e-9) {
        grams = 0;
        cost = 0;
      }
      sold.grams += entry.grams;
      sold.amount += entry.amount ?? 0;
    } else {
      grams += entry.grams;
      cost =
        cost === null || entry.amount === null ? null : cost + entry.amount;
      if (entry.type === 'buy') {
        bought.grams += entry.grams;
        bought.amount += entry.amount ?? 0;
      }
    }
    history.push({ ...entry, heldAfter: grams3(grams), realizedGain });
  }
  return {
    grams: grams3(grams),
    cost: cost === null ? null : cents(cost),
    averagePerGram: cost === null || !grams ? null : cost / grams,
    realized: realized === null ? null : cents(realized),
    bought: { grams: grams3(bought.grams), amount: cents(bought.amount) },
    sold: { grams: grams3(sold.grams), amount: cents(sold.amount) },
    history,
  };
}

export type MetalValuation = MetalPosition & {
  rate: ChosenRate | null;
  /** Grams × today's rate × purity; null when there is no rate at all. */
  value: number | null;
  gain: number | null;
  gainPercent: number | null;
};

export function valueMetal(
  asset: MetalAsset,
  rates: MetalRateRow[],
  asOf: string,
): MetalValuation {
  const position = metalPosition(asset);
  const rate = chooseRate(rates, asset.metal, asOf);
  const value =
    position.grams === 0
      ? 0
      : rate
        ? cents(
            position.grams *
              rate.pkrPerGram *
              (asset.metal === 'gold' ? purity(asset.karat) : 1),
          )
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
export function metalFlows(
  asset: MetalAsset,
): { date: string; amount: number }[] {
  return order(asset.entries)
    .filter((e) => e.amount !== null)
    .map((e) => ({
      date: e.date,
      amount: e.type === 'sell' ? -e.amount! : e.amount!,
    }));
}

export const metalUnknownCost = (asset: MetalAsset) =>
  order(asset.entries).some((e) => e.type !== 'sell' && e.amount === null);

/** Throws with a plain message when the assets cannot be saved. Used by the ledger's strict write check. */
export function validateAssets(
  assets: unknown,
  today: string,
): asserts assets is Asset[] | undefined {
  if (assets === undefined) return;
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS)
    throw new Error('Invalid assets.');
  const ids = new Set<string>();
  for (const a of assets as Asset[]) {
    if (!a || (a.kind !== 'metal' && a.kind !== 'plan' && a.kind !== 'fund'))
      throw new Error('Unsupported asset type.');
    if (
      typeof a.id !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(a.id) ||
      ids.has(a.id)
    )
      throw new Error('Invalid asset identifier.');
    ids.add(a.id);
    if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80)
      throw new Error('Asset names must be 1 to 80 characters.');
    if (typeof a.note !== 'string' || a.note.length > 2000)
      throw new Error('Asset note is too long.');
    if (a.kind === 'plan') {
      validatePlan(a, today);
      continue;
    }
    if (a.kind === 'fund') {
      validateFund(a, today);
      continue;
    }
    if (a.metal !== 'gold' && a.metal !== 'silver')
      throw new Error('Choose gold or silver.');
    if (![24, 22, 21, 18].includes(a.karat))
      throw new Error('Choose a purity of 24, 22, 21 or 18 karat.');
    if (!Array.isArray(a.entries) || a.entries.length > MAX_ENTRIES)
      throw new Error('Invalid asset entries.');
    const entryIds = new Set<string>();
    for (const e of a.entries) {
      if (!e || typeof e.id !== 'string' || !e.id || entryIds.has(e.id))
        throw new Error('Invalid asset entry identifier.');
      entryIds.add(e.id);
      if (!['opening', 'buy', 'sell'].includes(e.type))
        throw new Error('Invalid asset entry type.');
      if (typeof e.date !== 'string' || !DATE.test(e.date) || e.date > today)
        throw new Error(
          'Asset entry dates must be real dates that are not in the future.',
        );
      if (!Number.isFinite(e.grams) || e.grams <= 0 || e.grams > 1_000_000)
        throw new Error('Enter a weight greater than zero.');
      if (
        e.amount !== null &&
        (!Number.isFinite(e.amount) || e.amount < 0 || e.amount > 1e12)
      )
        throw new Error('Enter a valid amount.');
      if (e.amount === null && e.type !== 'opening')
        throw new Error('Only an opening balance may have an unknown cost.');
      if (
        e.pieces !== undefined &&
        (!Number.isInteger(e.pieces) || e.pieces < 1 || e.pieces > 100_000)
      )
        throw new Error('Invalid piece count.');
      if (
        e.pieceGrams !== undefined &&
        (!Number.isFinite(e.pieceGrams) || e.pieceGrams <= 0)
      )
        throw new Error('Invalid piece weight.');
      if (e.form !== undefined && e.form !== 'coin' && e.form !== 'bar')
        throw new Error('Invalid piece type.');
      if (typeof e.note !== 'string' || e.note.length > 500)
        throw new Error('Entry note is too long.');
    }
    metalPosition(a); // throws when a sale exceeds the grams held
  }
}

export const newAssetId = () =>
  `asset-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
export const describePieces = (
  e: Pick<MetalEntry, 'pieces' | 'pieceGrams' | 'grams'>,
) => {
  const g = (n: number) => `${Math.round(n * 1000) / 1000} g`;
  if (e.pieces && e.pieceGrams) {
    const tola =
      Math.abs(
        e.pieceGrams / TOLA_GRAMS - Math.round(e.pieceGrams / TOLA_GRAMS),
      ) < 1e-3 && e.pieceGrams >= TOLA_GRAMS * 0.99;
    return `${e.pieces} × ${tola ? `${Math.round(e.pieceGrams / TOLA_GRAMS)} tola` : g(e.pieceGrams)} (${g(e.grams)})`;
  }
  return g(e.grams);
};

export type AssetClassKey = 'gold' | 'silver' | 'plans' | 'funds';
/** One asset reduced to what the totals need: its class, value, cost and money flows. Null means "not known", never zero. */
export type AssetValue = {
  classKey: AssetClassKey;
  value: number | null;
  /** Net money still in. Null while any cost is unknown. */
  cost: number | null;
  gain: number | null;
  /** Still held (grams left, plan not closed). */
  open: boolean;
  unknownCost: boolean;
  /** The value is calculated between statements, not read from one. */
  estimated: boolean;
  flows: { date: string; amount: number }[];
};

export function valueAsset(
  asset: Asset,
  rates: MetalRateRow[],
  asOf: string,
  navs: FundNavRow[] = [],
  planNavs: PlanNavRow[] = [],
): AssetValue {
  if (asset.kind === 'fund') {
    const v = valueFund(asset, navs, asOf);
    return {
      classKey: 'funds',
      value: v.value,
      cost: v.cost,
      gain: v.gain,
      open: v.units > 0 && !asset.closed,
      unknownCost: fundUnknownCost(asset),
      estimated: !!v.price?.stale,
      flows: fundFlows(asset),
    };
  }
  if (asset.kind === 'plan') {
    const v = planValue(asset, asOf, planNavs);
    return {
      classKey: 'plans',
      value: v.value,
      cost: v.cost,
      gain: v.gain,
      open: v.value > 0 || !asset.closed,
      unknownCost: false,
      estimated: v.source !== 'statement',
      flows: planFlows(asset),
    };
  }
  const v = valueMetal(asset, rates, asOf);
  return {
    classKey: asset.metal,
    value: v.value,
    cost: v.cost,
    gain: v.gain,
    open: v.grams > 0,
    unknownCost: metalUnknownCost(asset),
    estimated: false,
    flows: metalFlows(asset),
  };
}
