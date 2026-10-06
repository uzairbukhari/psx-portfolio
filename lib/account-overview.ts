// Numbers behind the All portfolios dashboard (web and phone). Pure: no React, no I/O, no clock.
//
// Every portfolio is calculated on its own first (`consolidatedAccount`), and only then added together, so cost
// basis is never mixed across portfolios. A figure that cannot be known (a missing price or an unknown cost)
// is reported as null with a reason, never as zero.
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

export function accountOverview(
  parts: (DisplayPart & { locked?: boolean })[],
  asOf: string,
): AccountOverview {
  const consolidated = consolidatedAccount({
    kind: 'sipwise-portfolio-account',
    version: 1,
    portfolios: parts,
  });
  const summary = consolidated.summary;
  const stockValue = summary.value;
  const total = stockValue;

  const classes: ClassTotal[] = [
    {
      key: 'stocks',
      label: ASSET_CLASS_LABELS.stocks,
      value: stockValue,
      share: share(stockValue, total),
      cost: summary.cost,
      gain: summary.gain,
      gainPercent: summary.gainPercent,
      count: summary.heldCount,
      incomplete: summary.incomplete.length > 0,
    },
  ];

  const portfolios: PortfolioTotal[] = consolidated.breakdown.map((entry) => ({
    id: entry.id,
    name: entry.name,
    locked: !!(entry as { locked?: boolean }).locked,
    value: entry.summary.value,
    cost: entry.summary.cost,
    gain: entry.summary.gain,
    gainPercent: entry.summary.gainPercent,
    share: share(entry.summary.value, total),
    heldCount: entry.summary.heldCount,
    missingPrice: entry.summary.missingPrice.length,
    unknownCost: entry.summary.unknownCost.length,
  }));

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
      share: share(value, total),
    }))
    .sort((a, b) => b.value - a.value);

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

  const incomplete: string[] = [];
  if (summary.missingPrice.length)
    incomplete.push(
      `Needs a price for ${summary.missingPrice.length} ${summary.missingPrice.length === 1 ? 'holding' : 'holdings'}.`,
    );
  if (summary.unknownCost.length)
    incomplete.push(
      `Needs the cost of ${summary.unknownCost.length} ${summary.unknownCost.length === 1 ? 'holding' : 'holdings'}.`,
    );

  const flows: CashFlow[] = [
    ...consolidated.breakdown.flatMap(
      (entry) => moneyInFlows(entry.portfolio).flows,
    ),
    ...dividendFlows,
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const unknownCostFlows = consolidated.breakdown.some(
    (entry) => moneyInFlows(entry.portfolio).unknownCost.length > 0,
  );
  const blockedBy = summary.missingPrice.length
    ? 'Needs a price for every holding.'
    : unknownCostFlows || summary.unknownCost.length
      ? 'Needs the cost of every holding.'
      : null;
  const mwr = moneyWeightedReturn(flows, stockValue, asOf);

  return {
    asOf,
    total: {
      value: stockValue,
      cost: summary.cost,
      gain: summary.gain,
      gainPercent: summary.gainPercent,
      incomplete,
      oldestQuoteDate: summary.oldestQuoteDate,
    },
    classes: classes.filter((c) => c.count > 0 || c.value > 0),
    portfolios,
    topHoldings,
    holdingCount: held.length,
    sectors,
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
