// Monthly SIP planner glue over the shared plan() calculation.
import { plan, today, type Portfolio } from '../../../lib/portfolio.ts';
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

export function setBudget(p: Portfolio, month: string, amount: number): Portfolio {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month.');
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a budget of zero or more.');
  const next = clonePortfolio(p);
  next.budgets[month] = amount;
  return next;
}
