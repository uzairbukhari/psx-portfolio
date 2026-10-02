// Target-weight editing shared by the web dialog and the mobile editor: which companies the monthly
// SIP plan splits money across, with what weights. Pure functions over the Portfolio payload; the
// caller validates and saves the result through the revisioned PUT.
import {
  SCREEN_MAX_AGE_DAYS,
  WEIGHT_CAP,
  dateOK,
  round,
  today,
  type Portfolio,
} from './portfolio.ts';
import { UserError } from './user-error.ts';

export type TargetRow = {
  ticker: string;
  /** Long-term portfolio weight in percent. */
  target: number;
  /** Enables new SIP purchases under the recorded Shariah screen. */
  approved: boolean;
  /** Effective date of that screen (YYYY-MM-DD), or ''. */
  screenDate: string;
};

/** Companies that currently have a target, in portfolio order. */
export function targetRows(p: Portfolio): TargetRow[] {
  return p.companies
    .filter((c) => c.target > 0)
    .map((c) => ({ ticker: c.ticker, target: c.target, approved: c.approved, screenDate: c.screenDate }));
}

export type TargetTotals = {
  total: number;
  /** Points still to allocate (negative when over 100). */
  remaining: number;
  status: 'empty' | 'under' | 'exact' | 'over';
  /** Tickers whose weight exceeds the per-company cap; the plan treats those as the cap. */
  overCap: string[];
};

export function targetTotals(rows: Pick<TargetRow, 'ticker' | 'target'>[]): TargetTotals {
  // Weights are saved to two decimals, so total those. plan() rejects anything but 100 beyond a 0.01 float
  // tolerance, which means a total of 99.99 would be refused there: only an exact 100 counts as complete.
  const total = round(rows.reduce((sum, r) => sum + (Number.isFinite(r.target) ? round(r.target) : 0), 0));
  const remaining = round(100 - total);
  const status = rows.length === 0 ? 'empty' : remaining === 0 ? 'exact' : remaining > 0 ? 'under' : 'over';
  return {
    total,
    remaining,
    status,
    overCap: rows.filter((r) => r.target > WEIGHT_CAP).map((r) => r.ticker),
  };
}

/** `count` weights (in percent, two decimals) that add up to exactly 100. */
export function evenWeights(count: number): number[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const cents = 10_000;
  const base = Math.floor(cents / count);
  const extra = cents - base * count;
  return Array.from({ length: count }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

export type ScreenStatus = {
  state: 'valid' | 'not-enabled' | 'no-date' | 'future' | 'expired';
  /** Last day the screen keeps new purchases enabled, when a date is recorded. */
  validUntil: string | null;
  label: string;
};

const addDays = (date: string, days: number) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Mirrors the eligibility rule in plan(): enabled, dated, not in the future and at most 183 days old. */
export function screenStatus(row: Pick<TargetRow, 'approved' | 'screenDate'>, asOf: string = today()): ScreenStatus {
  const dated = row.screenDate && dateOK(row.screenDate);
  const validUntil = dated ? addDays(row.screenDate, SCREEN_MAX_AGE_DAYS) : null;
  if (!row.approved)
    return { state: 'not-enabled', validUntil, label: 'New buys are off, so no purchases are suggested.' };
  if (!dated) return { state: 'no-date', validUntil: null, label: 'Add the screening date to enable suggested buys.' };
  if (row.screenDate > asOf) return { state: 'future', validUntil, label: 'The screening date is in the future.' };
  if (asOf > validUntil!)
    return { state: 'expired', validUntil, label: `Screen expired on ${validUntil}; new buys are paused until it is renewed.` };
  return { state: 'valid', validUntil, label: `Screened ${row.screenDate}, valid to ${validUntil}.` };
}

/**
 * Returns a copy of the portfolio where exactly the companies in `rows` carry the given targets (every other
 * company goes back to 0, which removes it from the plan) and their screening fields are updated. Throws a
 * UserError unless the weights are positive, name known companies and total 100%.
 */
export function applyTargets(p: Portfolio, rows: TargetRow[], asOf: string = today()): Portfolio {
  if (!rows.length) throw new UserError('Choose at least one company and give it a target weight.');
  const known = new Set(p.companies.map((c) => c.ticker));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!known.has(r.ticker)) throw new UserError(`${r.ticker} is not in your portfolio.`);
    if (seen.has(r.ticker)) throw new UserError(`${r.ticker} is listed twice.`);
    seen.add(r.ticker);
    if (!Number.isFinite(r.target) || !(round(r.target) > 0) || r.target > 100)
      throw new UserError(`Give ${r.ticker} a weight above 0% and at most 100%, or remove it.`);
    if (r.screenDate && (!dateOK(r.screenDate) || r.screenDate > asOf))
      throw new UserError(`Enter ${r.ticker}'s screening date as YYYY-MM-DD, not in the future.`);
  }
  const { total, status } = targetTotals(rows);
  if (status !== 'exact') throw new UserError(`Target weights must total 100% (they are ${total}% now).`);
  const byTicker = new Map(rows.map((r) => [r.ticker, r]));
  const next = JSON.parse(JSON.stringify(p)) as Portfolio;
  for (const c of next.companies) {
    const row = byTicker.get(c.ticker);
    if (!row) {
      c.target = 0;
      continue;
    }
    c.target = round(row.target);
    c.approved = row.approved;
    c.screenDate = row.screenDate;
  }
  return next;
}
