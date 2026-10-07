// Numbers behind the All portfolios dashboard (web and phone). Pure: no React, no I/O, no clock.
//
// Every portfolio is calculated on its own first (`consolidatedAccount`), and only then added together, so cost
// basis is never mixed across portfolios. A figure that cannot be known (a missing price or an unknown cost)
// is reported as null with a reason, never as zero.
import { valueAsset } from './assets.ts';
import type { MetalRateRow } from './metal-rates.ts';
import type { FundNavRow } from './mufap.ts';
import type { PlanNavRow } from './plans.ts';
import {
  moneyInFlows,
  moneyWeightedReturn,
  type CashFlow,
  type MoneyWeightedReturn,
} from './performance.ts';
import { consolidatedAccount } from './portfolio-account.ts';
import { round, taxYearOf, type DisplayPart } from './portfolio.ts';

export type AssetClassKey = 'stocks' | 'gold' | 'silver' | 'plans' | 'funds';
export const ASSET_CLASS_LABELS: Record<AssetClassKey, string> = {
  stocks: 'Stocks',
  gold: 'Gold',
  silver: 'Silver',
  plans: 'Savings plans',
  funds: 'Mutual funds',
};

export type ClassTotal = {
  key: AssetClassKey;
  label: string;
  value: number;
  /** Share of the total value, 0 to 100. */
  share: number;
  cost: number | null;
  gain: number | null;
  gainPercent: number | null;
  /** Positions in this class (companies, items, memberships, funds). */
  count: number;
  incomplete: boolean;
};
export type PortfolioTotal = {
  id: string;
  name: string;
  locked: boolean;
  value: number;
  cost: number | null;
  gain: number | null;
  gainPercent: number | null;
  share: number;
  heldCount: number;
  missingPrice: number;
  unknownCost: number;
};
export type HoldingTotal = {
  ticker: string;
  name: string;
  sector: string;
  value: number;
  share: number;
  gain: number | null;
  gainPercent: number | null;
  portfolios: string[];
};
export type SectorTotal = { sector: string; value: number; share: number };
export type IncomeMonth = { month: string; amount: number };
export type InvestedMonth = { month: string; amount: number } & Record<AssetClassKey, number>;

/** Sectors shown on the All dashboard; the rest roll into one Other slice. */
export const TOP_SECTOR_COUNT = 6;

export type AccountOverview = {
  asOf: string;
  total: {
    value: number;
    /** Remaining cost of what is held; null while any cost is unknown. */
    cost: number | null;
    gain: number | null;
    gainPercent: number | null;
    /** Why the headline is incomplete, in plain words. Empty when nothing is missing. */
    incomplete: string[];
    oldestQuoteDate: string | null;
  };
  classes: ClassTotal[];
  portfolios: PortfolioTotal[];
  /** Largest holdings across every portfolio, merged by ticker. */
  topHoldings: HoldingTotal[];
  holdingCount: number;
  sectors: SectorTotal[];
  /** Money paid in per month over the last twelve months, oldest first: stock buys, fund and plan paid-in, gold and silver purchases. Sales, redemptions and cash back are not subtracted. */
  invested: { months: InvestedMonth[]; total: number };
  income: {
    taxYear: string;
    /** Dividends received in the current tax year (gross). */
    received: number;
    /** All dividends received so far (gross). */
    receivedTotal: number;
    /** Announced, unconfirmed dividends: a planning figure, never income. */
    expected: number;
    expectedCount: number;
    /** Last twelve months of received dividends by payment month, oldest first. */
    months: IncomeMonth[];
  };
  /** Money-weighted return with received dividends counted as cash back; null with a reason when not honest. */
  returns: MoneyWeightedReturn & {
    blockedBy: string | null;
    includesIncome: true;
  };
};

const percent = (gain: number | null, cost: number | null) =>
  gain !== null && cost !== null && cost > 0 ? (gain / cost) * 100 : null;
const share = (part: number, total: number) =>
  total > 0 ? (part / total) * 100 : 0;

function lastMonths(asOf: string, count: number): string[] {
  const [y, m] = [Number(asOf.slice(0, 4)), Number(asOf.slice(5, 7))];
  return Array.from({ length: count }, (_, i) => {
    const index = y * 12 + (m - 1) - (count - 1 - i);
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

const sumKnown = (values: (number | null)[]) =>
  values.some((n) => n === null)
    ? null
    : round(values.reduce<number>((a, n) => a + n!, 0));

export function accountOverview(
  parts: (DisplayPart & { locked?: boolean })[],
  asOf: string,
  options: {
    metalRates?: MetalRateRow[];
    fundNavs?: FundNavRow[];
    planNavs?: PlanNavRow[];
  } = {},
): AccountOverview {
  const consolidated = consolidatedAccount({
    kind: 'sipwise-portfolio-account',
    version: 1,
    portfolios: parts,
  });
  const summary = consolidated.summary;
  const stockValue = summary.value;

  // Every other asset (gold and silver, savings plans), valued per asset and added up by class.
  const rates = options.metalRates ?? [];
  const assetValues = parts.flatMap((part) =>
    (part.portfolio.assets ?? []).map((asset) => ({
      asset,
      v: valueAsset(
        asset,
        rates,
        asOf,
        options.fundNavs ?? [],
        options.planNavs ?? [],
      ),
    })),
  );
  const assetClass = (key: AssetClassKey): ClassTotal | null => {
    const mine = assetValues.filter((m) => m.v.classKey === key);
    if (!mine.length) return null;
    const value = round(mine.reduce((n, m) => n + (m.v.value ?? 0), 0));
    const cost = sumKnown(mine.map((m) => m.v.cost));
    const gain =
      cost === null || mine.some((m) => m.v.value === null)
        ? null
        : round(value - cost);
    return {
      key,
      label: ASSET_CLASS_LABELS[key],
      value,
      share: 0,
      cost,
      gain,
      gainPercent: percent(gain, cost),
      count: mine.filter((m) => m.v.open).length,
      incomplete: mine.some((m) => m.v.value === null || m.v.cost === null),
    };
  };
  const otherClasses = (['gold', 'silver', 'plans', 'funds'] as const)
    .map(assetClass)
    .filter((c): c is ClassTotal => c !== null);
  const total = round(
    stockValue + otherClasses.reduce((n, c) => n + c.value, 0),
  );

  const classes: ClassTotal[] = [
    {
      key: 'stocks' as const,
      label: ASSET_CLASS_LABELS.stocks,
      value: stockValue,
      share: share(stockValue, total),
      cost: summary.cost,
      gain: summary.gain,
      gainPercent: summary.gainPercent,
      count: summary.heldCount,
      incomplete: summary.incomplete.length > 0,
    },
    ...otherClasses,
  ].map((c): ClassTotal => ({ ...c, share: share(c.value, total) }));

  const portfolios: PortfolioTotal[] = consolidated.breakdown.map((entry) => {
    const own = assetValues.filter((m) =>
      entry.portfolio.assets?.includes(m.asset),
    );
    const value = round(
      entry.summary.value + own.reduce((n, m) => n + (m.v.value ?? 0), 0),
    );
    const cost = own.length
      ? sumKnown([entry.summary.cost, ...own.map((m) => m.v.cost)])
      : entry.summary.cost;
    const gain = own.length
      ? cost === null ||
        entry.summary.gain === null ||
        own.some((m) => m.v.value === null)
        ? null
        : round(value - cost)
      : entry.summary.gain;
    return {
      id: entry.id,
      name: entry.name,
      locked: !!(entry as { locked?: boolean }).locked,
      value,
      cost,
      gain,
      gainPercent: percent(gain, cost),
      share: share(value, total),
      heldCount: entry.summary.heldCount + own.filter((m) => m.v.open).length,
      missingPrice:
        entry.summary.missingPrice.length +
        own.filter((m) => m.v.value === null).length,
      unknownCost:
        entry.summary.unknownCost.length +
        own.filter((m) => m.v.cost === null).length,
    };
  });

  const sectorOf = new Map<string, string>();
  for (const entry of consolidated.breakdown)
    for (const h of entry.positions)
      if (h.shares > 0 && !sectorOf.has(h.ticker))
        sectorOf.set(h.ticker, h.sector || 'Others');
  const held = consolidated.positions;
  const topHoldings: HoldingTotal[] = held
    .filter((h) => h.value !== null)
    .slice(0, 8)
    .map((h) => ({
      ticker: h.ticker,
      name: h.name,
      sector: sectorOf.get(h.ticker) ?? 'Others',
      value: h.value!,
      share: share(h.value!, total),
      gain: h.gain,
      gainPercent: percent(h.gain, h.cost),
      portfolios: h.portfolios.map((p) => p.name),
    }));
  const sectorValues = new Map<string, number>();
  for (const h of held) {
    if (h.value === null) continue;
    const sector = sectorOf.get(h.ticker) ?? 'Others';
    sectorValues.set(sector, (sectorValues.get(sector) ?? 0) + h.value);
  }
  const sectors = [...sectorValues.entries()]
    .map(([sector, value]) => ({
      sector,
      value: round(value),
      share: share(value, stockValue),
    }))
    .sort((a, b) => b.value - a.value);
  if (sectors.length > TOP_SECTOR_COUNT + 1) {
    const rest = sectors.slice(TOP_SECTOR_COUNT);
    sectors.length = TOP_SECTOR_COUNT;
    const value = round(rest.reduce((n, r) => n + r.value, 0));
    sectors.push({ sector: 'Other', value, share: share(value, stockValue) });
  }

  // Income: received dividends only. Expected ones are a plan, not money.
  const taxYear = taxYearOf(asOf);
  const months = lastMonths(asOf, 12);
  const byMonth = new Map(months.map((m) => [m, 0]));
  let received = 0;
  let receivedTotal = 0;
  const dividendFlows: CashFlow[] = [];
  for (const entry of consolidated.breakdown)
    for (const d of entry.tax.dividends) {
      if (d.status !== 'received') continue;
      receivedTotal += d.grossAmount;
      if (d.paymentDateUnknown) continue;
      const paid = d.paymentDate ?? d.date;
      if (taxYearOf(paid) === taxYear) received += d.grossAmount;
      const month = paid.slice(0, 7);
      if (byMonth.has(month))
        byMonth.set(month, (byMonth.get(month) ?? 0) + d.grossAmount);
      // Money that came back to you: net of tax where known.
      dividendFlows.push({
        date: paid,
        amount: -(d.netAmount ?? d.grossAmount),
      });
    }

  // Cash dividends from mutual funds are income too. Their cash-back flows are already part of the fund's flows.
  for (const { asset } of assetValues) {
    if (asset.kind !== 'fund') continue;
    for (const e of asset.entries) {
      if (e.type !== 'dividend' || e.voided || e.date > asOf || !e.amount)
        continue;
      receivedTotal += e.amount;
      if (taxYearOf(e.date) === taxYear) received += e.amount;
      const month = e.date.slice(0, 7);
      if (byMonth.has(month))
        byMonth.set(month, (byMonth.get(month) ?? 0) + e.amount);
    }
  }

  const incomplete: string[] = [];
  if (summary.missingPrice.length)
    incomplete.push(
      `Needs a price for ${summary.missingPrice.length} ${summary.missingPrice.length === 1 ? 'holding' : 'holdings'}.`,
    );
  if (summary.unknownCost.length)
    incomplete.push(
      `Needs the cost of ${summary.unknownCost.length} ${summary.unknownCost.length === 1 ? 'holding' : 'holdings'}.`,
    );

  const metalMissing = assetValues.filter((m) => m.v.value === null);
  const metalUnknown = assetValues.filter((m) => m.v.unknownCost);
  if (metalMissing.length)
    incomplete.push(
      `Needs a ${[...new Set(metalMissing.map((m) => (m.asset.kind === 'metal' ? `${m.asset.metal} rate` : 'fund price')))].join(' and ')}.`,
    );
  if (metalUnknown.length)
    incomplete.push(
      `Needs the cost of ${metalUnknown.length} ${metalUnknown.length === 1 ? 'investment' : 'investments'} outside stocks.`,
    );
  const totalCost = sumKnown([
    summary.cost,
    ...otherClasses.map((c) => c.cost),
  ]);
  const totalGain =
    totalCost === null ||
    summary.gain === null ||
    otherClasses.some((c) => c.gain === null)
      ? null
      : round(total - totalCost);

  const flows: CashFlow[] = [
    ...consolidated.breakdown.flatMap(
      (entry) => moneyInFlows(entry.portfolio).flows,
    ),
    ...assetValues.flatMap((m) => m.v.flows),
    ...dividendFlows,
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const unknownCostFlows = consolidated.breakdown.some(
    (entry) => moneyInFlows(entry.portfolio).unknownCost.length > 0,
  );
  const blockedBy =
    summary.missingPrice.length || metalMissing.length
      ? 'Needs a price for every holding.'
      : unknownCostFlows || summary.unknownCost.length || metalUnknown.length
        ? 'Needs the cost of every holding.'
        : null;
  const classKeys = ['stocks', 'gold', 'silver', 'plans', 'funds'] as const;
  const investedByMonth = new Map(
    months.map((m) => [m, { stocks: 0, gold: 0, silver: 0, plans: 0, funds: 0 }]),
  );
  const addInvested = (key: AssetClassKey, list: CashFlow[]) => {
    for (const f of list) {
      // Only money going in: buys and paid-in. Sales, redemptions and cash back are negative flows.
      if (f.amount <= 0 || f.date > asOf) continue;
      const row = investedByMonth.get(f.date.slice(0, 7));
      if (row) row[key] += f.amount;
    }
  };
  for (const entry of consolidated.breakdown)
    addInvested('stocks', moneyInFlows(entry.portfolio).flows);
  for (const m of assetValues) addInvested(m.v.classKey, m.v.flows);
  const investedMonths = months.map((month) => {
    const row = investedByMonth.get(month)!;
    const rounded = Object.fromEntries(
      classKeys.map((k) => [k, round(row[k])]),
    ) as Record<AssetClassKey, number>;
    return {
      month,
      ...rounded,
      amount: round(classKeys.reduce((n, k) => n + row[k], 0)),
    };
  });
  const mwr = moneyWeightedReturn(flows, total, asOf);

  return {
    asOf,
    total: {
      value: total,
      cost: totalCost,
      gain: totalGain,
      gainPercent: percent(totalGain, totalCost),
      incomplete,
      oldestQuoteDate: summary.oldestQuoteDate,
    },
    classes: classes.filter((c) => c.count > 0 || c.value > 0),
    portfolios,
    topHoldings,
    holdingCount: held.length,
    sectors,
    invested: {
      months: investedMonths,
      total: round(investedMonths.reduce((n, m) => n + m.amount, 0)),
    },
    income: {
      taxYear,
      received: round(received),
      receivedTotal: round(receivedTotal),
      expected: consolidated.breakdown.reduce(
        (n, e) => n + e.tax.expectedDividends.grossAmount,
        0,
      ),
      expectedCount: consolidated.tax.expectedDividends,
      months: months.map((month) => ({
        month,
        amount: round(byMonth.get(month) ?? 0),
      })),
    },
    returns: {
      ...(blockedBy
        ? { rate: null, reason: 'no-solution' as const, days: mwr.days }
        : mwr),
      blockedBy,
      includesIncome: true,
    },
  };
}
