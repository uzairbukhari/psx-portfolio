import { holdings, round, type Portfolio } from './portfolio.ts';

export type AllocationPoint = {
  ticker: string;
  name: string;
  sector: string;
  value: number;
  weight: number;
};

export type SectorPoint = {
  sector: string;
  value: number;
  weight: number;
};

export type TargetPoint = {
  ticker: string;
  actual: number | null;
  target: number;
};

export type ActivityPoint = {
  month: string;
  invested: number;
};

export type PortfolioReport = {
  companyAllocation: AllocationPoint[];
  sectorAllocation: SectorPoint[];
  targetComparison: TargetPoint[];
  monthlyActivity: ActivityPoint[];
  summary: {
    pricedValue: number;
    largestHolding: AllocationPoint | null;
    topThreeWeight: number | null;
    largestSector: SectorPoint | null;
    quoteCoverage: {
      priced: number;
      held: number;
      percentage: number;
    };
  };
};

const percentage = (part: number, total: number) =>
  total > 0 ? round((part / total) * 100) : 0;

export function portfolioReport(portfolio: Portfolio): PortfolioReport {
  const allHoldings = holdings(portfolio);
  const held = allHoldings.filter((item) => item.shares > 0);
  const priced = held.filter(
    (item): item is typeof item & { value: number } =>
      typeof item.value === 'number',
  );
  const pricedValue = round(
    priced.reduce((total, item) => total + item.value, 0),
  );

  const companyAllocation = priced
    .filter((item) => item.value > 0)
    .map((item) => ({
      ticker: item.ticker,
      name: item.name,
      sector: item.sector || 'Unassigned',
      value: item.value,
      weight: percentage(item.value, pricedValue),
    }))
    .sort((a, b) => b.value - a.value || a.ticker.localeCompare(b.ticker));

  const sectorValues = new Map<string, number>();
  for (const item of companyAllocation) {
    sectorValues.set(
      item.sector,
      round((sectorValues.get(item.sector) ?? 0) + item.value),
    );
  }
  const sectorAllocation = [...sectorValues]
    .map(([sector, value]) => ({
      sector,
      value,
      weight: percentage(value, pricedValue),
    }))
    .sort((a, b) => b.value - a.value || a.sector.localeCompare(b.sector));

  const hasCompleteQuotes = held.length > 0 && priced.length === held.length;
  const targetComparison = allHoldings
    .filter((item) => item.target > 0)
    .map((item) => ({
      ticker: item.ticker,
      actual:
        hasCompleteQuotes && pricedValue > 0
          ? percentage(item.value ?? 0, pricedValue)
          : null,
      target: item.target,
    }));

  const activity = new Map<string, number>();
  for (const trade of portfolio.trades) {
    if (trade.voided || trade.kind !== 'buy' || trade.price === null) continue;
    const month = trade.month || trade.date.slice(0, 7);
    activity.set(
      month,
      round(
        (activity.get(month) ?? 0) + trade.shares * trade.price + trade.fees,
      ),
    );
  }
  const monthlyActivity = [...activity]
    .map(([month, invested]) => ({ month, invested }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    companyAllocation,
    sectorAllocation,
    targetComparison,
    monthlyActivity,
    summary: {
      pricedValue,
      largestHolding: companyAllocation[0] ?? null,
      topThreeWeight: companyAllocation.length
        ? round(
            companyAllocation
              .slice(0, 3)
              .reduce((total, item) => total + item.weight, 0),
          )
        : null,
      largestSector: sectorAllocation[0] ?? null,
      quoteCoverage: {
        priced: priced.length,
        held: held.length,
        percentage: percentage(priced.length, held.length),
      },
    },
  };
}
