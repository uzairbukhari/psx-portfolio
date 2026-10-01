// Pure view-model helpers over the shared portfolio code (no React / native imports,
// so they can be unit tested with plain node).
import { holdings, portfolioSummary, type AppNotification, type Portfolio } from '../../../lib/portfolio.ts';

export type Holding = ReturnType<typeof holdings>[number];

export function safeHoldings(portfolio: Portfolio): { held: Holding[]; error: string | null } {
  try {
    return { held: holdings(portfolio), error: null };
  } catch (e) {
    return { held: [], error: e instanceof Error ? e.message : 'Could not compute holdings.' };
  }
}

/** Headline numbers shared with the web (value of priced holdings; cost and gain only when complete). */
export const totals = (held: Holding[]) => portfolioSummary(held);

/**
 * Companies whose price the plans need: everything held or targeted, the Monthly Picks shortlist, and any
 * extra tickers (for example the selection on screen). Only companies in the portfolio, no duplicates.
 */
export function priceTickers(portfolio: Portfolio, extra: string[] = []): string[] {
  const known = new Set(portfolio.companies.map((c) => c.ticker));
  const wanted = new Set<string>();
  const { held } = safeHoldings(portfolio);
  for (const h of held) if (h.shares > 0 || h.target > 0) wanted.add(h.ticker);
  for (const t of [...(portfolio.monthlyPicksShortlist ?? []), ...extra]) wanted.add(t);
  return [...wanted].filter((t) => known.has(t));
}

export function openPositions(held: Holding[]): Holding[] {
  return held
    .filter((h) => h.shares > 0)
    .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.ticker.localeCompare(b.ticker));
}

export type ActivityEntry = {
  id: string;
  date: string;
  kind: 'opening' | 'buy' | 'sell' | 'dividend' | 'split';
  ticker: string;
  title: string;
  detail: string;
  amount: number | null;
  /** Entered by hand (or legacy), so it can be corrected here; imported/automatic lines are read-only. */
  editable: boolean;
};

const num = (n: number) => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(n);

/** Trades, dividends and splits as one newest-first list; voided entries are dropped. */
export function activityEntries(p: Portfolio, ticker?: string): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const t of p.trades) {
    if (t.voided || (ticker && t.ticker !== ticker)) continue;
    const price = t.price === null ? 'price unknown' : `@ ${num(t.price)}`;
    out.push({
      id: t.id,
      date: t.date,
      kind: t.kind,
      ticker: t.ticker,
      title: `${t.kind === 'sell' ? 'Sold' : t.kind === 'opening' ? 'Opening' : 'Bought'} ${num(t.shares)}`,
      detail: `${price}${t.fees ? ` · fees ${num(t.fees)}` : ''}`,
      amount: t.price === null ? null : t.shares * t.price,
      editable: !t.source || t.source === 'manual',
    });
  }
  for (const d of p.dividends ?? []) {
    if (d.voided || (ticker && d.ticker !== ticker)) continue;
    const expected = (d.status ?? 'expected') === 'expected' && d.source === 'auto';
    out.push({
      id: d.id,
      date: d.paymentDate ?? d.date,
      kind: 'dividend',
      ticker: d.ticker,
      title: expected ? 'Dividend (expected)' : 'Dividend',
      detail: d.perShare ? `${num(d.perShare)} per share` : d.note,
      amount: d.netAmount ?? d.grossAmount ?? null,
      editable: d.source === 'manual',
    });
  }
  for (const s of p.stockSplits ?? []) {
    if (s.voided || (ticker && s.ticker !== ticker)) continue;
    out.push({
      id: s.id,
      date: s.date,
      kind: 'split',
      ticker: s.ticker,
      title: 'Stock split',
      detail: `${num(s.oldShares)} → ${num(s.newShares)} shares`,
      amount: null,
      editable: true,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
}

/** Why an entry cannot be edited on the phone, or null when it can (or when no such entry exists). */
export function readOnlyReason(p: Portfolio, id: string): string | null {
  const t = p.trades.find((x) => x.id === id);
  if (t) return t.voided ? "Voided entries can't be edited." : t.source && t.source !== 'manual' ? "Imported entries can't be edited." : null;
  const d = p.dividends?.find((x) => x.id === id);
  if (d) return d.voided ? "Voided entries can't be edited." : d.source !== 'manual' ? "Automatic and imported dividends can't be edited." : null;
  const sp = p.stockSplits?.find((x) => x.id === id);
  if (sp?.voided) return "Voided entries can't be edited.";
  return null;
}

/** Notifications still in the bell (not cleared), newest first. */
export function activeNotifications(p: Portfolio): AppNotification[] {
  return (p.notifications ?? []).filter((n) => !n.clearedAt).sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function formatPercent(n: number | null): string {
  if (n === null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}
