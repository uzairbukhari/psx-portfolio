import { DISPLAY_PARTS } from '../../../lib/portfolio.ts';
// View-models for the Today screen (pure): the return breakdown behind "See total return", this month's
// progress, and the next actions list. Calculations stay in lib/; this only arranges them.
import { lastTradingDay } from '../../../lib/psx-calendar.ts';
import { round, taxSummary, type Portfolio } from '../../../lib/portfolio.ts';
import type { Holding } from './derive.ts';
import { buildPlan, type SipPlan } from './sip.ts';

export type ReturnBreakdown = {
  /** Value minus cost of current holdings; null while a price or cost is missing. */
  unrealised: number | null;
  /** Sales at average cost, after fees, before tax. */
  realised: number;
  /** Dividends with status received, gross. Expected dividends are not included. */
  dividendsReceived: number;
  /** Unrealised + realised + dividends received, before tax; null when unrealised is not known. */
  totalBeforeTax: number | null;
  /** The same after estimated tax (what Reports calls total return); null when a tax figure is missing. */
  afterTax: number | null;
  expected: { count: number; gross: number };
};

export function returnBreakdown(p: Portfolio, unrealised: number | null): ReturnBreakdown | null {
  let tax: ReturnType<typeof taxSummary>;
  try {
    tax = taxSummary(p);
  } catch {
    return null;
  }
  const realised = tax.totalRealizedGain;
  const dividendsReceived = tax.totalDividendIncomeGross;
  return {
    unrealised,
    realised,
    dividendsReceived,
    totalBeforeTax: unrealised === null ? null : round(unrealised + realised + dividendsReceived),
    afterTax: unrealised === null || tax.netRealizedReturn === null ? null : round(unrealised + tax.netRealizedReturn),
    expected: { count: tax.expectedDividends.count, gross: tax.expectedDividends.grossAmount },
  };
}

export type MonthProgress = {
  month: string;
  budgetSet: boolean;
  budget: number;
  bought: number;
  remaining: number;
  /** Bought / budget, 0 when no budget is set. */
  fraction: number;
  /** Whole-share buys the plan suggests right now. */
  suggested: number;
  /** Why no buys are suggested (target totals, prices, ...), already worded for the user. */
  blockers: string[];
  planError: string | null;
};

/** Progress for one month from the shared plan(); `plan()` falls back to a default budget the user never chose, so `budgetSet` says whether it is real. */
export function monthProgress(p: Portfolio, month: string, feePct = 0, allowOld = false): MonthProgress {
  if (p[DISPLAY_PARTS]) {
    const parts = p[DISPLAY_PARTS]!.map((part)=>monthProgress(part.portfolio,month,feePct,allowOld));
    const budget=parts.reduce((n,p)=>n+p.budget,0),bought=parts.reduce((n,p)=>n+p.bought,0);
    return {month,budgetSet:parts.some((p)=>p.budgetSet),budget,bought,remaining:Math.max(0,budget-bought),fraction:budget>0 ? Math.min(1,bought/budget) : 0,suggested:0,blockers:[],planError:null};
  }
  const built = buildPlan(p, month, feePct, allowOld);
  const plan: SipPlan | null = built.plan;
  const budgetSet = p.budgets[month] !== undefined;
  const budget = budgetSet ? p.budgets[month] : 0;
  const bought = plan?.already ?? 0;
  return {
    month,
    budgetSet,
    budget,
    bought,
    remaining: budgetSet ? Math.max(0, round(budget - bought)) : 0,
    fraction: budgetSet && budget > 0 ? Math.min(1, bought / budget) : 0,
    suggested: plan && budgetSet && !plan.errors.length ? plan.rows.filter((r) => r.shares > 0).length : 0,
    blockers: plan?.errors ?? [],
    planError: built.error,
  };
}

export type NextAction =
  | { key: 'dividend'; title: string; detail: string; id: string; ticker: string }
  | { key: 'prices'; title: string; detail: string; tickers: string[] }
  | { key: 'targets'; title: string; detail: string }
  | { key: 'budget'; title: string; detail: string }
  | { key: 'plan'; title: string; detail: string };

/** Companies the plan and summary need a current price for: held or targeted, with no quote or one older than the last trading day. */
export function stalePriceTickers(held: Holding[], now: string): string[] {
  const last = lastTradingDay(now);
  return held.filter((h) => (h.shares > 0 || h.target > 0) && (!h.quote || h.quote.date < last)).map((h) => h.ticker);
}

/** At most three things that need the user, in priority order, each one tap from its fix. */
export function nextActions(p: Portfolio, held: Holding[], month: string, now: string, limit = 3): NextAction[] {
  const out: NextAction[] = [];
  let expected: { id: string; ticker: string }[] = [];
  try {
    expected = taxSummary(p)
      .dividends.filter((d) => d.status === 'expected')
      .map((d) => ({ id: d.id, ticker: d.ticker }));
  } catch {
    // a broken ledger shows its own error elsewhere
  }
  if (expected.length)
    out.push({
      key: 'dividend',
      title: expected.length === 1 ? `Confirm the expected ${expected[0].ticker} dividend` : `Confirm ${expected.length} expected dividends`,
      detail: 'Mark received once it arrives so it counts as income.',
      id: expected[0].id,
      ticker: expected[0].ticker,
    });
  const stale = stalePriceTickers(held, now);
  if (stale.length)
    out.push({
      key: 'prices',
      title: stale.length === 1 ? `Refresh the price for ${stale[0]}` : `Refresh ${stale.length} stale prices`,
      detail: stale.length > 3 ? `${stale.slice(0, 3).join(', ')} and more are older than the last trading day.` : `${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} older than the last trading day.`,
      tickers: stale,
    });
  const targeted = p.companies.some((c) => c.target > 0);
  if (!targeted && p.companies.length)
    out.push({ key: 'targets', title: 'Set your targets', detail: 'Choose the companies your monthly SIP buys and their weights.' });
  else if (targeted && p.budgets[month] === undefined) out.push({ key: 'budget', title: 'Set this month’s budget', detail: 'Then Sipwise suggests whole-share buys toward your targets.' });
  else if (targeted) {
    const progress = monthProgress(p, month);
    if (progress.suggested > 0)
      out.push({ key: 'plan', title: `${progress.suggested} ${progress.suggested === 1 ? 'buy' : 'buys'} suggested this month`, detail: 'Review them in Plan and record them in one step.' });
  }
  return out.slice(0, limit);
}
