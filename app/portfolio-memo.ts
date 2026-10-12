import { holdings, taxSummary, type Portfolio } from '@/lib/portfolio';

/**
 * Remembers a derivation per Portfolio object. The dashboard keeps the decrypted ledger as immutable state (every
 * edit builds a new object), so the same object means the same answer. DashboardContent re-renders on every key
 * typed into a dialog and used to replay the whole ledger each time; hooks can't be used there because the
 * component returns early until the portfolio has loaded.
 */
function byPortfolio<T>(derive: (p: Portfolio) => T) {
  const cache = new WeakMap<Portfolio, T>();
  return (p: Portfolio): T => {
    if (cache.has(p)) return cache.get(p) as T;
    const value = derive(p);
    cache.set(p, value);
    return value;
  };
}

export const cachedHoldings = byPortfolio(holdings);
export const cachedTaxSummary = byPortfolio(taxSummary);
