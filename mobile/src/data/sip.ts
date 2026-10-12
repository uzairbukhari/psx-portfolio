// Monthly SIP planner glue over the shared plan() calculation.
import { DISPLAY_PARTS, plan, today, type Portfolio } from '../../../lib/portfolio.ts';
import { ALL_PORTFOLIOS, dashboardPortfolio, type NamedPortfolio, type PortfolioAccount } from '../../../lib/portfolio-account.ts';
import { clonePortfolio } from './mutations.ts';

export type SipPlan = ReturnType<typeof plan>;

export function currentMonth(): string {
  return today().slice(0, 7);
}

/** Months you can plan for: this month and the next. Past months are only reviewable on the web. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function buildPlan(
  p: Portfolio,
  month: string,
  feePct: number,
  allowOld: boolean,
): { plan: SipPlan | null; error: string | null } {
  try {
    return { plan: plan(p, month, feePct, allowOld), error: null };
  } catch (e) {
    return { plan: null, error: e instanceof Error ? e.message : 'Could not build the plan.' };
  }
}

export type MonthBuy = { id: string; date: string; ticker: string; shares: number; price: number | null; fees: number; amount: number; note: string };

/**
 * The buys that count toward a month's budget, the same rule the plan uses for "bought this month": tagged to the SIP
 * month, or untagged and dated in it. Amount includes fees, so the list adds up to the figure on the budget card.
 */
export function monthBuys(p: Portfolio, month: string): MonthBuy[] {
  return p.trades
    .filter((t) => !t.voided && t.kind === 'buy' && (t.month === month || (!t.month && t.date.slice(0, 7) === month)))
    .map((t) => ({ id: t.id, date: t.date, ticker: t.ticker, shares: t.shares, price: t.price, fees: t.fees, amount: Math.round(((t.price === null ? 0 : t.shares * t.price) + t.fees) * 100) / 100, note: t.note }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
}

export function setBudget(p: Portfolio, month: string, amount: number): Portfolio {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month.');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a budget of zero or more.');
  const next = clonePortfolio(p);
  next.budgets[month] = amount;
  return next;
}

/**
 * One SIP plan for the whole account: weights are measured against every portfolio's holdings together, while the
 * budget and the target weights live in the first ("home") portfolio, the same place Monthly Picks keeps its list.
 */
export function unifiedPlanSource(account: PortfolioAccount): { home: NamedPortfolio; portfolio: Portfolio } {
  const home = account.portfolios[0];
  const combined = dashboardPortfolio(account, ALL_PORTFOLIOS);
  // plan() refuses a display-only combined portfolio, so hand it a plain copy.
  const portfolio: Portfolio = { ...combined };
  delete portfolio[DISPLAY_PARTS];
  portfolio.budgets = { ...home.portfolio.budgets };
  const homeCompanies = new Map(home.portfolio.companies.map((c) => [c.ticker, c]));
  portfolio.companies = combined.companies.map((c) => homeCompanies.get(c.ticker) ?? c);
  return { home, portfolio };
}
