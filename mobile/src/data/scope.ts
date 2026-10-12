// What a portfolio holds, in words (pure). Used by the portfolio chooser and the empty states.
import type { Portfolio } from '../../../lib/portfolio.ts';
import { safeHoldings } from './derive.ts';

export type Contents = { stocks: number; plans: number; funds: number; metals: number };

export function portfolioContents(p: Portfolio): Contents {
  const assets = p.assets ?? [];
  return {
    stocks: safeHoldings(p).held.filter((h) => h.shares > 0).length,
    plans: assets.filter((a) => a.kind === 'plan').length,
    funds: assets.filter((a) => a.kind === 'fund').length,
    metals: assets.filter((a) => a.kind === 'metal').length,
  };
}

export const addContents = (a: Contents, b: Contents): Contents => ({ stocks: a.stocks + b.stocks, plans: a.plans + b.plans, funds: a.funds + b.funds, metals: a.metals + b.metals });

/** "21 stocks · 1 plan · 2 funds", or "Empty" when there is nothing yet. */
export function contentsLabel(c: Contents): string {
  const part = (n: number, one: string, many: string) => (n ? [`${n} ${n === 1 ? one : many}`] : []);
  const parts = [...part(c.stocks, 'stock', 'stocks'), ...part(c.plans, 'plan', 'plans'), ...part(c.funds, 'fund', 'funds'), ...part(c.metals, 'gold or silver item', 'gold or silver items')];
  return parts.length ? parts.join(' · ') : 'Empty';
}

export const hasAnything = (c: Contents) => c.stocks + c.plans + c.funds + c.metals > 0;
