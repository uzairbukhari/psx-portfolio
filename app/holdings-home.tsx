'use client';
// The top of Holdings: the net worth slab with its chart, then SIP progress, the KSE-100 and the asset mix.
// Figures come from `accountOverview` (one part for a single portfolio, every part for All); the market card and the
// day change use the public market summary, merged with the saved quotes on this device.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { FundNavRow } from '@/lib/mufap';
import type { PlanNavRow } from '@/lib/plans';
import type { FxRateRow } from '@/lib/fx-rates';
import type { MetalRateRow } from '@/lib/metal-rates';
import { moneyInFlows } from '@/lib/performance';
import type { DisplayPart, Portfolio } from '@/lib/portfolio';
import AccountOverview from './account-overview';
import SipGlance from './sip-glance';
import type { SipBlueprint, SipClass } from '@/lib/sip-blueprint';
import { useMarketGlance, type MarketGlance } from './use-market-glance';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const GlanceContext = createContext<MarketGlance | null>(null);

/** One public market summary for the whole Holdings page (the KSE-100 card, the day change and the Today column). */
export function MarketGlanceProvider({
  held,
  p,
  children,
}: {
  held: { ticker: string }[];
  p: Portfolio;
  children: ReactNode;
}) {
  const tickers = useMemo(() => held.map((h) => h.ticker).sort().slice(0, 60), [held]);
  const names = useMemo(() => Object.fromEntries(p.companies.map((c) => [c.ticker, c.name])), [p.companies]);
  const glance = useMarketGlance(tickers, names, p.quotes);
  return <GlanceContext.Provider value={glance}>{children}</GlanceContext.Provider>;
}

const EMPTY_GLANCE: MarketGlance = { index: null, breadth: null, series: [], companies: [], market: null };

/** Today's move for one company, as a pill; a dash until the market summary has it. */
export function TodayPill({ ticker }: { ticker: string }) {
  const glance = useContext(GlanceContext) ?? EMPTY_GLANCE;
  const row = glance.companies.find((c) => c.ticker === ticker);
  const pct = row?.changePercent;
  if (pct === null || pct === undefined) return <span className="fa">—</span>;
  const flat = pct === 0;
  return (
    <span className={`pill ${flat ? '' : pct > 0 ? 'g' : 'l'}`}>
      {flat ? '' : pct > 0 ? '▲ ' : '▼ '}
      {Math.abs(pct).toFixed(2)}%
    </span>
  );
}

export default function HoldingsHome({
  p,
  parts,
  isAll,
  scopeName,
  held,
  toCheck,
  month,
  asOf,
  metalRates,
  fxRates,
  fundNavs,
  planNavs,
  chart,
  onOpenPlan,
  onFix,
  onOpenPortfolio,
  sipBlueprint = null,
  sipParts = [],
  onOpenSip,
}: {
  p: Portfolio;
  parts: DisplayPart[];
  isAll: boolean;
  scopeName: string;
  held: { ticker: string; shares: number }[];
  toCheck: number;
  month: string;
  asOf: string;
  metalRates: MetalRateRow[];
  fxRates: FxRateRow[];
  fundNavs: FundNavRow[];
  planNavs: PlanNavRow[];
  chart: ReactNode;
  onOpenPlan?: () => void;
  onFix: () => void;
  onOpenPortfolio: (id: string) => void;
  /** My SIP plan (account-wide). When set, the SIP card shows its steps instead of the stock-only Plan budget. */
  sipBlueprint?: SipBlueprint | null;
  /** Every portfolio, because My SIP covers the whole account whichever portfolio is on screen. */
  sipParts?: DisplayPart[];
  onOpenSip?: (step?: SipClass) => void;
}) {
  const glance = useContext(GlanceContext) ?? EMPTY_GLANCE;

  const today = useMemo(() => {
    const change = new Map(glance.companies.map((c) => [c.ticker, c.change]));
    let amount = 0;
    let covered = 0;
    let base = 0;
    for (const h of held) {
      const c = change.get(h.ticker);
      const price = glance.companies.find((x) => x.ticker === h.ticker)?.price ?? null;
      if (c === null || c === undefined || price === null) continue;
      amount += c * h.shares;
      base += (price - c) * h.shares;
      covered += 1;
    }
    return covered > 0 && base > 0 ? { amount, percent: (amount / base) * 100 } : null;
  }, [glance.companies, held]);

  const sip = useMemo(() => {
    const fresh = p.budgets[month] ?? 100000;
    const put = moneyInFlows(p)
      .flows.filter((f) => f.date.startsWith(month))
      .reduce((sum, f) => sum + f.amount, 0);
    return { label: MONTHS[Number(month.slice(5, 7)) - 1] ?? '', fresh, put };
  }, [p, month]);

  return (
    <AccountOverview
      parts={isAll ? parts : [{ id: 'current', name: scopeName, portfolio: p }]}
      compact={!isAll}
      scopeName={scopeName}
      asOf={asOf}
      metalRates={metalRates}
      fxRates={fxRates}
      fundNavs={fundNavs}
      planNavs={planNavs}
      onOpenPortfolio={onOpenPortfolio}
      glance={glance}
      today={today}
      toCheck={toCheck}
      sip={sip}
      sipCard={
        sipBlueprint && onOpenSip ? (
          <SipGlance
            b={sipBlueprint}
            parts={sipParts}
            rates={{ metalRates, fxRates, fundNavs, planNavs }}
            asOf={asOf}
            onOpen={onOpenSip}
          />
        ) : undefined
      }
      onSetupSip={!sipBlueprint && onOpenSip ? () => onOpenSip() : undefined}
      onOpenPlan={onOpenPlan}
      onFix={onFix}
      chart={chart}
    />
  );
}
