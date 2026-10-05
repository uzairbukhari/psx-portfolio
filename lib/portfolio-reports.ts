import {
  holdings,
  portfolioSummary,
  round,
  taxSummary,
  today,
  type Portfolio,
  type TaxedSale,
  type TaxedDividend,
  type TaxYearSummary,
} from './portfolio.ts';

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
  cumulative: number;
};

export type PerformancePoint = {
  ticker: string;
  name: string;
  cost: number;
  value: number;
  gain: number;
  gainPercent: number;
};

export type DividendActivityPoint = {
  month: string;
  gross: number;
  net: number | null;
  cumulativeNet: number | null;
};

export type DividendCompanyPoint = {
  ticker: string;
  name: string;
  gross: number;
  net: number | null;
  weight: number | null;
};

export type RealizedActivityPoint = {
  month: string;
  gain: number;
  net: number | null;
  cumulativeNet: number | null;
};

export type RealizedCompanyPoint = {
  ticker: string;
  name: string;
  gain: number;
  net: number | null;
  weight: number | null;
};

export type InvestmentCompanyPoint = {
  ticker: string;
  name: string;
  amount: number;
  weight: number;
};

export type InvestmentActivityPoint = {
  month: string;
  total: number;
  byCompany: { ticker: string; name: string; amount: number }[];
};

export type PortfolioReport = {
  companyAllocation: AllocationPoint[];
  sectorAllocation: SectorPoint[];
  targetComparison: TargetPoint[];
  monthlyActivity: ActivityPoint[];
  performance: PerformancePoint[];
  dividendActivity: DividendActivityPoint[];
  dividendByCompany: DividendCompanyPoint[];
  realizedActivity: RealizedActivityPoint[];
  realizedByCompany: RealizedCompanyPoint[];
  recentInvestmentByCompany: InvestmentCompanyPoint[];
  recentInvestmentActivity: InvestmentActivityPoint[];
  realized: {
    sales: TaxedSale[];
    dividends: TaxedDividend[];
    totalRealizedGain: number;
    totalCapitalGainsTax: number | null;
    totalDividendIncomeGross: number;
    totalDividendTax: number | null;
    netRealizedReturn: number | null;
    /** Capital-gains tax per Pakistani tax year, with whether it is an estimate or recorded. */
    taxYears: TaxYearSummary[];
    /** Announced dividends awaiting receipt confirmation; not part of any income total. */
    expectedDividends: ReturnType<typeof taxSummary>['expectedDividends'];
    /** Received on the user's confirmation with no known payment date; never given a made-up date. */
    receivedUnknownPaymentDate: ReturnType<typeof taxSummary>['receivedUnknownPaymentDate'];
    taxProfileSet: boolean;
  };
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
    totalGain: number | null;
    totalGainPercent: number | null;
    grandTotalReturn: number | null;
  };
};

const percentage = (part: number, total: number) =>
  total > 0 ? round((part / total) * 100) : 0;

/** The `count` YYYY-MM calendar months ending with `dateStr`'s month, oldest first. */
function lastMonths(dateStr: string, count: number): string[] {
  const [year, month] = dateStr.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export function portfolioReport(portfolio: Portfolio): PortfolioReport {
  const allHoldings = holdings(portfolio);
  const held = allHoldings.filter((item) => item.shares > 0);
  const priced = held.filter(
    (item): item is typeof item & { value: number } =>
      typeof item.value === 'number',
  );
  const pricedValue = portfolioSummary(allHoldings).value;

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
  let cumulative = 0;
  const monthlyActivity = [...activity]
    .map(([month, invested]) => ({ month, invested }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => {
      cumulative = round(cumulative + item.invested);
      return { ...item, cumulative };
    });

  const performance = priced
    .filter(
      (item): item is typeof item & { cost: number } =>
        typeof item.cost === 'number',
    )
    .map((item) => ({
      ticker: item.ticker,
      name: item.name,
      cost: item.cost,
      value: item.value,
      gain: round(item.value - item.cost),
      gainPercent: item.cost > 0 ? round(((item.value - item.cost) / item.cost) * 100) : 0,
    }))
    .sort((a, b) => b.gain - a.gain || a.ticker.localeCompare(b.ticker));

  const totalCost = round(
    performance.reduce((total, item) => total + item.cost, 0),
  );
  const totalValue = round(
    performance.reduce((total, item) => total + item.value, 0),
  );
  const totalGain = performance.length ? round(totalValue - totalCost) : null;

  const tax = taxSummary(portfolio);

  const dividendMonths = new Map<
    string,
    { gross: number; net: number | null }
  >();
  for (const d of tax.dividends.filter((x) => x.status === 'received')) {
    const month = d.date.slice(0, 7);
    const entry = dividendMonths.get(month) ?? { gross: 0, net: 0 };
    dividendMonths.set(month, {
      gross: round(entry.gross + d.grossAmount),
      net:
        entry.net === null || d.netAmount === null
          ? null
          : round(entry.net + d.netAmount),
    });
  }
  let cumulativeNet: number | null = 0;
  const dividendActivity: DividendActivityPoint[] = [...dividendMonths]
    .map(([month, item]) => ({ month, ...item }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => {
      cumulativeNet =
        cumulativeNet === null || item.net === null
          ? null
          : round(cumulativeNet + item.net);
      return { ...item, cumulativeNet };
    });

  const companyNames = new Map(
    portfolio.companies.map((c) => [c.ticker, c.name]),
  );

  const recentInvestmentMonths = lastMonths(today(), 12);
  const recentInvestmentMonthSet = new Set(recentInvestmentMonths);
  const investmentByMonth = new Map<string, Map<string, number>>();
  for (const trade of portfolio.trades) {
    if (trade.voided || trade.kind !== 'buy' || trade.price === null) continue;
    const month = trade.month || trade.date.slice(0, 7);
    if (!recentInvestmentMonthSet.has(month)) continue;
    const byTicker = investmentByMonth.get(month) ?? new Map<string, number>();
    byTicker.set(
      trade.ticker,
      round(
        (byTicker.get(trade.ticker) ?? 0) + trade.shares * trade.price + trade.fees,
      ),
    );
    investmentByMonth.set(month, byTicker);
  }
  const recentInvestmentActivity: InvestmentActivityPoint[] =
    recentInvestmentMonths.map((month) => {
      const byTicker = investmentByMonth.get(month) ?? new Map<string, number>();
      const byCompany = [...byTicker]
        .map(([ticker, amount]) => ({
          ticker,
          name: companyNames.get(ticker) ?? ticker,
          amount,
        }))
        .sort((a, b) => b.amount - a.amount || a.ticker.localeCompare(b.ticker));
      return {
        month,
        total: round(byCompany.reduce((total, item) => total + item.amount, 0)),
        byCompany,
      };
    });

  const recentInvestmentTotals = new Map<string, number>();
  for (const point of recentInvestmentActivity) {
    for (const item of point.byCompany) {
      recentInvestmentTotals.set(
        item.ticker,
        round((recentInvestmentTotals.get(item.ticker) ?? 0) + item.amount),
      );
    }
  }
  const totalRecentInvestment = round(
    [...recentInvestmentTotals.values()].reduce(
      (total, amount) => total + amount,
      0,
    ),
  );
  const recentInvestmentByCompany: InvestmentCompanyPoint[] = [
    ...recentInvestmentTotals,
  ]
    .map(([ticker, amount]) => ({
      ticker,
      name: companyNames.get(ticker) ?? ticker,
      amount,
      weight:
        totalRecentInvestment > 0
          ? percentage(amount, totalRecentInvestment)
          : 0,
    }))
    .sort((a, b) => b.amount - a.amount || a.ticker.localeCompare(b.ticker));

  const dividendCompanies = new Map<
    string,
    { gross: number; net: number | null }
  >();
  for (const d of tax.dividends.filter((x) => x.status === 'received')) {
    const entry = dividendCompanies.get(d.ticker) ?? { gross: 0, net: 0 };
    dividendCompanies.set(d.ticker, {
      gross: round(entry.gross + d.grossAmount),
      net:
        entry.net === null || d.netAmount === null
          ? null
          : round(entry.net + d.netAmount),
    });
  }
  const totalDividendNet = [...dividendCompanies.values()].some(
    (item) => item.net === null,
  )
    ? null
    : round(
        [...dividendCompanies.values()].reduce(
          (total, item) => total + (item.net ?? 0),
          0,
        ),
      );
  const dividendByCompany: DividendCompanyPoint[] = [...dividendCompanies]
    .map(([ticker, item]) => ({
      ticker,
      name: companyNames.get(ticker) ?? ticker,
      gross: item.gross,
      net: item.net,
      weight:
        item.net === null || totalDividendNet === null || totalDividendNet <= 0
          ? null
          : percentage(item.net, totalDividendNet),
    }))
    .sort(
      (a, b) =>
        (b.net ?? b.gross) - (a.net ?? a.gross) ||
        a.ticker.localeCompare(b.ticker),
    );

  const realizedMonths = new Map<string, { gain: number; net: number | null }>();
  for (const s of tax.sales) {
    const month = s.date.slice(0, 7);
    const entry = realizedMonths.get(month) ?? { gain: 0, net: 0 };
    realizedMonths.set(month, {
      gain: round(entry.gain + (s.realizedGain ?? 0)),
      net: entry.net === null || s.net === null ? null : round(entry.net + s.net),
    });
  }
  let cumulativeRealizedNet: number | null = 0;
  const realizedActivity: RealizedActivityPoint[] = [...realizedMonths]
    .map(([month, item]) => ({ month, ...item }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((item) => {
      cumulativeRealizedNet =
        cumulativeRealizedNet === null || item.net === null
          ? null
          : round(cumulativeRealizedNet + item.net);
      return { ...item, cumulativeNet: cumulativeRealizedNet };
    });

  const realizedCompanies = new Map<
    string,
    { gain: number; net: number | null }
  >();
  for (const s of tax.sales) {
    const entry = realizedCompanies.get(s.ticker) ?? { gain: 0, net: 0 };
    realizedCompanies.set(s.ticker, {
      gain: round(entry.gain + (s.realizedGain ?? 0)),
      net: entry.net === null || s.net === null ? null : round(entry.net + s.net),
    });
  }
  const totalRealizedNet = [...realizedCompanies.values()].some(
    (item) => item.net === null,
  )
    ? null
    : round(
        [...realizedCompanies.values()].reduce(
          (total, item) => total + (item.net ?? 0),
          0,
        ),
      );
  const realizedByCompany: RealizedCompanyPoint[] = [...realizedCompanies]
    .map(([ticker, item]) => ({
      ticker,
      name: companyNames.get(ticker) ?? ticker,
      gain: item.gain,
      net: item.net,
      weight:
        item.net === null ||
        totalRealizedNet === null ||
        totalRealizedNet <= 0
          ? null
          : percentage(item.net, totalRealizedNet),
    }))
    .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain) || a.ticker.localeCompare(b.ticker));

  return {
    companyAllocation,
    sectorAllocation,
    targetComparison,
    monthlyActivity,
    performance,
    dividendActivity,
    dividendByCompany,
    realizedActivity,
    realizedByCompany,
    recentInvestmentByCompany,
    recentInvestmentActivity,
    realized: {
      sales: tax.sales,
      dividends: tax.dividends,
      totalRealizedGain: tax.totalRealizedGain,
      totalCapitalGainsTax: tax.totalCapitalGainsTax,
      totalDividendIncomeGross: tax.totalDividendIncomeGross,
      totalDividendTax: tax.totalDividendTax,
      netRealizedReturn: tax.netRealizedReturn,
      taxYears: tax.taxYears,
      expectedDividends: tax.expectedDividends,
      receivedUnknownPaymentDate: tax.receivedUnknownPaymentDate,
      taxProfileSet: portfolio.taxProfile !== undefined,
    },
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
      totalGain,
      totalGainPercent:
        performance.length && totalCost > 0
          ? round(((totalValue - totalCost) / totalCost) * 100)
          : null,
      grandTotalReturn:
        totalGain === null || tax.netRealizedReturn === null
          ? null
          : round(totalGain + tax.netRealizedReturn),
    },
  };
}
