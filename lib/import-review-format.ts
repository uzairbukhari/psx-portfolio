// Pure helpers for the import review dialogs: number and date formatting, month grouping, the "before you import"
// checklist and the holdings preview for broker statements. Kept free of React so tests can run it directly.
import type { HoldingChange } from './ahl-reconcile.ts';
import type { BrokerImportPlan } from './broker-import.ts';
import { holdings, type Portfolio } from './portfolio.ts';

const en = (options: Intl.NumberFormatOptions) => (n: number) => n.toLocaleString('en-US', options);
export const fmtQty = en({ maximumFractionDigits: 0 });
export const fmtPrice = en({ minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const fmtFees = en({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtRs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-US')}`;
export const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** `2026-07-03` → `3 Jul`. */
export const dayMonth = (iso: string) => `${utc(iso).getUTCDate()} ${utc(iso).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })}`;
/** `2026-07-03` → `July 2026`. */
export const monthLabel = (iso: string) => utc(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Consecutive rows that share a month, in the order given (the caller decides the sort). */
export function groupByMonth<T extends { date: string }>(rows: readonly T[]): { label: string; rows: T[] }[] {
  const groups: { label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const label = monthLabel(row.date);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }
  return groups;
}

export type ReviewTodo = { key: string; text: string; done: boolean; anchor?: string };

/**
 * The checklist beside the review. `decisions` are the things the dialog can point at (an undecided row, a question
 * about older entries); `blockers` are the planner's own reasons the import is blocked. A blocker that a decision
 * already explains (`covered`) is dropped so the same problem is not listed twice.
 */
export function buildTodos({ decisions, blockers, covered, anchorFor }: {
  decisions: { key: string; text: string; done: boolean; anchor?: string }[];
  blockers: readonly string[];
  covered?: RegExp;
  anchorFor?: (blocker: string) => string | undefined;
}): ReviewTodo[] {
  const open = blockers.filter((b) => !covered?.test(b));
  return [
    ...decisions,
    ...open.map((text, i) => ({ key: `blocker-${i}`, text, done: false, anchor: anchorFor?.(text) })),
  ];
}
export const openTodos = (todos: readonly ReviewTodo[]) => todos.filter((t) => !t.done).length;

/** What each company's share count becomes if a broker statement import is applied as currently chosen. */
export function brokerHoldingChanges(p: Portfolio, plan: BrokerImportPlan): HoldingChange[] {
  let current: ReturnType<typeof holdings>;
  try {
    current = holdings(p);
  } catch {
    return []; // a ledger that does not add up is reported by the plan's own blockers
  }
  const before = new Map(current.map((h) => [h.ticker, h.shares]));
  const after = new Map(before);
  const unknownCost = new Set<string>();
  for (const row of plan.rows) {
    if (row.action !== 'import') continue;
    const delta = row.trade.side === 'buy' ? row.trade.shares : -row.trade.shares;
    after.set(row.trade.ticker, (after.get(row.trade.ticker) ?? 0) + delta);
  }
  for (const a of plan.adjustments) {
    if (a.action !== 'import') continue;
    after.set(a.ticker, (after.get(a.ticker) ?? 0) + a.difference);
    unknownCost.add(a.ticker);
  }
  return [...after.keys()].sort()
    .map((ticker) => ({
      ticker, beforeShares: before.get(ticker) ?? 0, afterShares: after.get(ticker) ?? 0,
      beforeCostKnown: true, afterCostKnown: !unknownCost.has(ticker),
    }))
    .filter((c) => c.beforeShares !== c.afterShares);
}

/** The line beside the Import button: why it is disabled, or that it is ready. */
export function footerStatus({ open, noop, stale }: { open: number; noop: boolean; stale: boolean }): { text: string; ok: boolean } {
  if (stale) return { text: 'Your portfolio changed. Review the updated preview', ok: false };
  if (open) return { text: `${open} ${plural(open, 'thing')} to decide before importing`, ok: false };
  if (noop) return { text: 'Nothing new to import', ok: false };
  return { text: 'Ready to import', ok: true };
}

/** `2026-07-03` → `3 Jul 2026`. */
export const dayMonthYear = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;
/** "3 Jul 2026 to 12 Sep 2026" from any list of ISO dates, or '' when there are none. */
export function dateRangeLabel(dates: readonly string[]): string {
  const sorted = dates.filter(Boolean).sort();
  if (!sorted.length) return '';
  const [from, to] = [sorted[0], sorted[sorted.length - 1]];
  return from === to ? dayMonthYear(from) : `${dayMonthYear(from)} to ${dayMonthYear(to)}`;
}
