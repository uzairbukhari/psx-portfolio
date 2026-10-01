// Pure helpers behind the add-entry form: live totals, split preview and company search.
import { round, sharesHeldOn, type Portfolio } from '../../../lib/portfolio.ts';

export type TradeTotals = { gross: number; fees: number; total: number; label: string };

/**
 * What a trade comes to including fees: a buy costs shares x price plus fees, a sale pays shares x price
 * less fees. Null until shares and price are usable (opening balances without a price have no total).
 */
export function tradeTotals(kind: 'buy' | 'sell' | 'opening', shares: number | null, price: number | null, fees: number | null): TradeTotals | null {
  if (!shares || shares <= 0 || price === null || !(price > 0)) return null;
  const fee = fees !== null && fees > 0 ? fees : 0;
  const gross = round(shares * price);
  if (kind === 'sell') return { gross, fees: fee, total: round(gross - fee), label: 'Net proceeds after fees' };
  return { gross, fees: fee, total: round(gross + fee), label: kind === 'opening' ? 'Opening cost including fees' : 'Total cost including fees' };
}

export type SplitPreview = { before: number; after: number } | { error: string };

/** Shares held on `date` before the split and after it, so the user sees the effect before saving. */
export function splitPreview(p: Portfolio, ticker: string, date: string, oldShares: number | null, newShares: number | null): SplitPreview | null {
  if (!ticker || !oldShares || !newShares || oldShares <= 0 || newShares <= oldShares) return null;
  let before: number;
  try {
    before = sharesHeldOn(p, ticker, date);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not work out your holding.' };
  }
  const after = (before * newShares) / oldShares;
  if (!Number.isSafeInteger(after)) return { error: `A ${newShares}-for-${oldShares} split of ${before} shares leaves fractional shares.` };
  return { before, after };
}

/** Companies matching a search by ticker or name (case-insensitive); ticker matches first. Empty query keeps all. */
export function filterCompanies<T extends { ticker: string; name: string }>(companies: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  const sorted = [...companies].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!q) return sorted;
  const rank = (c: T) => (c.ticker.toLowerCase().startsWith(q) ? 0 : c.ticker.toLowerCase().includes(q) ? 1 : c.name.toLowerCase().includes(q) ? 2 : 3);
  return sorted.filter((c) => rank(c) < 3).sort((a, b) => rank(a) - rank(b));
}
