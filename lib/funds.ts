// Mutual funds held in a portfolio (any AMC reporting to MUFAP). Pure and self-contained, like lib/assets.ts.
//
// Every entry is dated and never overwritten. Redeeming removes units at the average cost immediately before the redemption
// (the rule stocks and gold use), so the realised gain is recorded on that redemption. Cash dividends are income and count
// as money back to you; reinvested dividends add units and cost with no cash moving. Value is units x the price you would get
// on redemption, unless you entered a newer price yourself.
import { redemptionPrice, type FundNavRow } from './mufap.ts';
import type { PlanRule } from './plans.ts';

export type FundEntry = {
  id: string;
  date: string;
  type: 'opening' | 'buy' | 'redeem' | 'dividend' | 'reinvest';
  /** Units bought, redeemed or received by reinvestment. Absent on a cash dividend. */
  units?: number;
  /** Rupees paid (buy), received after load and tax (redeem), received in cash (dividend) or reinvested (reinvest). Null only on an opening balance with unknown cost. */
  amount: number | null;
  /** Actual tax withheld on a dividend or redemption, if the statement shows one. Never estimated. */
  taxWithheld?: number;
  /** Set when the entry came from a monthly rule the user confirmed. */
  recurringId?: string;
  note: string;
  voided?: boolean;
};
export type FundAsset = {
  id: string;
  kind: 'fund';
  name: string;
  mufapId: string;
  amc: string;
  fundName: string;
  category: string;
  note: string;
  entries: FundEntry[];
  /** A price you entered yourself; the newer of this and MUFAP's latest wins. */
  manualNavs: { id: string; date: string; nav: number; voided?: boolean }[];
  rules: PlanRule[];
  closed?: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const units6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const rank = (e: FundEntry) =>
  e.type === 'opening' ? 0 : e.type === 'redeem' ? 2 : 1;
const ordered = (entries: FundEntry[]) =>
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

export type FundPosition = {
  units: number;
  /** Remaining cost; null while an opening balance has no cost. */
  cost: number | null;
  averageNav: number | null;
  realized: number | null;
  /** Cash dividends received (gross of nothing: the amount received). */
  dividends: number;
  bought: { units: number; amount: number };
  redeemed: { units: number; amount: number };
  history: (FundEntry & { heldAfter: number; realizedGain: number | null })[];
};

export function fundPosition(fund: FundAsset): FundPosition {
  let units = 0;
  let cost: number | null = 0;
  let realized: number | null = 0;
  let dividends = 0;
  const bought = { units: 0, amount: 0 };
  const redeemed = { units: 0, amount: 0 };
  const history: FundPosition['history'] = [];
  for (const e of ordered(fund.entries)) {
    let realizedGain: number | null = null;
    if (e.type === 'redeem') {
      const u = e.units ?? 0;
      if (u > units + 1e-9)
        throw new Error(
          `${fund.name}: a redemption of ${u} units on ${e.date} exceeds the ${units6(units)} units held.`,
        );
      const average: number | null =
        cost === null ? null : units ? cost / units : 0;
      realizedGain =
        average === null || e.amount === null
          ? null
          : cents(e.amount - average * u);
      if (realizedGain === null) realized = null;
      else if (realized !== null) realized += realizedGain;
      cost = average === null ? null : Math.max(0, cost! - average * u);
      units -= u;
      if (units < 1e-9) {
        units = 0;
        cost = 0;
      }
      redeemed.units += u;
      redeemed.amount += e.amount ?? 0;
    } else if (e.type === 'dividend') {
      dividends += e.amount ?? 0;
    } else {
      units += e.units ?? 0;
      cost = cost === null || e.amount === null ? null : cost + e.amount;
      if (e.type === 'buy') {
        bought.units += e.units ?? 0;
        bought.amount += e.amount ?? 0;
      }
    }
    history.push({ ...e, heldAfter: units6(units), realizedGain });
  }
  return {
    units: units6(units),
    cost: cost === null ? null : cents(cost),
    averageNav: cost === null || !units ? null : cost / units,
    realized: realized === null ? null : cents(realized),
    dividends: cents(dividends),
    bought: { units: units6(bought.units), amount: cents(bought.amount) },
    redeemed: { units: units6(redeemed.units), amount: cents(redeemed.amount) },
    history,
  };
}

export type FundValuation = FundPosition & {
  /** The price used, with where it came from; null when no price is known at all. */
  price: {
    nav: number;
    date: string;
    source: 'mufap' | 'manual';
    stale: boolean;
  } | null;
  value: number | null;
  /** Unrealised gain on what is held (value less remaining cost, like stocks); null while a cost or the price is unknown. Dividends are income and are reported separately. */
  gain: number | null;
};

const STALE_DAYS = 7;
const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export function valueFund(
  fund: FundAsset,
  navs: FundNavRow[],
  asOf: string,
): FundValuation {
  const position = fundPosition(fund);
  const mine = navs
    .filter((n) => n.mufapId === fund.mufapId && n.date <= asOf)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  const manual = fund.manualNavs
    .filter((m) => !m.voided && m.date <= asOf)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0];
  const picked =
    manual && (!mine || manual.date >= mine.date)
      ? { nav: manual.nav, date: manual.date, source: 'manual' as const }
      : mine
        ? {
            nav: redemptionPrice(mine),
            date: mine.date,
            source: 'mufap' as const,
          }
        : null;
  const price = picked
    ? {
        ...picked,
        stale: dayNumber(asOf) - dayNumber(picked.date) > STALE_DAYS,
      }
    : null;
  const value =
    fund.closed || position.units === 0
      ? 0
      : price
        ? cents(position.units * price.nav)
        : null;
  const gain =
    value === null || position.cost === null
      ? null
      : cents(value - position.cost);
  return { ...position, price, value, gain };
}

/** Investor-view money flows: cash paid in positive; redemptions and cash dividends negative. Reinvested dividends move no cash. */
export function fundFlows(fund: FundAsset): { date: string; amount: number }[] {
  return ordered(fund.entries)
    .filter(
      (e) =>
        e.amount !== null &&
        (e.type === 'buy' ||
          e.type === 'opening' ||
          e.type === 'redeem' ||
          e.type === 'dividend'),
    )
    .map((e) => ({
      date: e.date,
      amount:
        e.type === 'redeem' || e.type === 'dividend' ? -e.amount! : e.amount!,
    }));
}
export const fundUnknownCost = (fund: FundAsset) =>
  ordered(fund.entries).some(
    (e) => (e.type === 'opening' || e.type === 'buy') && e.amount === null,
  );

/** Throws with a plain message when the fund cannot be saved. */
export function validateFund(fund: FundAsset, today: string) {
  if (typeof fund.mufapId !== 'string' || !/^\d{1,8}$/.test(fund.mufapId))
    throw new Error('Choose a fund from the list.');
  for (const field of [fund.amc, fund.fundName, fund.category])
    if (typeof field !== 'string' || field.length > 200)
      throw new Error('Invalid fund details.');
  if (
    !Array.isArray(fund.entries) ||
    fund.entries.length > 5000 ||
    !Array.isArray(fund.manualNavs) ||
    fund.manualNavs.length > 1000 ||
    !Array.isArray(fund.rules) ||
    fund.rules.length > 50
  )
    throw new Error('Invalid fund records.');
  const ids = new Set<string>();
  for (const e of fund.entries) {
    if (!e || typeof e.id !== 'string' || !e.id || ids.has(e.id))
      throw new Error('Invalid fund entry identifier.');
    ids.add(e.id);
    if (!['opening', 'buy', 'redeem', 'dividend', 'reinvest'].includes(e.type))
      throw new Error('Invalid fund entry type.');
    if (typeof e.date !== 'string' || !DATE.test(e.date) || e.date > today)
      throw new Error(
        'Fund entry dates must be real dates that are not in the future.',
      );
    if (
      e.type !== 'dividend' &&
      !(Number.isFinite(e.units) && e.units! > 0 && e.units! <= 1e12)
    )
      throw new Error('Enter the number of units.');
    if (
      e.amount !== null &&
      (!Number.isFinite(e.amount) || e.amount < 0 || e.amount > 1e12)
    )
      throw new Error('Enter a valid amount.');
    if (e.amount === null && e.type !== 'opening')
      throw new Error('Only an opening balance may have an unknown cost.');
    if (e.type === 'dividend' && !(e.amount! > 0))
      throw new Error('Enter the dividend received.');
    if (
      e.taxWithheld !== undefined &&
      (!Number.isFinite(e.taxWithheld) || e.taxWithheld < 0)
    )
      throw new Error('Invalid tax amount.');
    if (typeof e.note !== 'string' || e.note.length > 500)
      throw new Error('Entry note is too long.');
  }
  for (const m of fund.manualNavs) {
    if (
      !m ||
      typeof m.id !== 'string' ||
      ids.has(m.id) ||
      typeof m.date !== 'string' ||
      !DATE.test(m.date) ||
      m.date > today ||
      !(Number.isFinite(m.nav) && m.nav > 0)
    )
      throw new Error('Invalid price you entered.');
    ids.add(m.id);
  }
  for (const r of fund.rules) {
    if (
      !Number.isInteger(r.dayOfMonth) ||
      r.dayOfMonth < 1 ||
      r.dayOfMonth > 28 ||
      !(r.amount > 0) ||
      !/^\d{4}-\d{2}$/.test(r.from) ||
      !Array.isArray(r.skipped)
    )
      throw new Error('Invalid monthly schedule.');
  }
  fundPosition(fund); // throws when a redemption exceeds the units held
}

export const newFundId = () =>
  `fund-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
