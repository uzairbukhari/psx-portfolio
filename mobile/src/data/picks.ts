// Monthly Picks glue: what is saved with the portfolio (shared with the web), company search and source links.
import type { MonthlyPick, CompanyOutlook } from '../../../lib/monthly-picks.ts';
import type { Company, Portfolio } from '../../../lib/portfolio.ts';
import { clonePortfolio } from './mutations.ts';

/** Same limit as the web shortlist. */
export const MAX_SHORTLIST = 15;

/** The shortlist the screen starts from: the saved one, else the companies that have a target. */
export function initialShortlist(p: Portfolio): string[] {
  const saved = p.monthlyPicksShortlist?.length ? p.monthlyPicksShortlist : p.companies.filter((c) => c.target > 0).map((c) => c.ticker);
  return saved.slice(0, MAX_SHORTLIST);
}

/**
 * The portfolio with this shortlist and month amount saved where the web reads them
 * (`monthlyPicksShortlist` and `budgets[month]`), or null when nothing changed and nothing needs saving.
 */
export function withPicksInputs(p: Portfolio, month: string, shortlist: string[], amount: number): Portfolio | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid month.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter the amount to invest.');
  const known = new Set(p.companies.map((c) => c.ticker));
  const list = [...new Set(shortlist)].filter((t) => known.has(t)).slice(0, MAX_SHORTLIST);
  const changed = JSON.stringify(p.monthlyPicksShortlist ?? []) !== JSON.stringify(list) || p.budgets[month] !== amount;
  if (!changed) return null;
  const next = clonePortfolio(p);
  next.monthlyPicksShortlist = list;
  next.budgets[month] = amount;
  return next;
}

/** Companies whose ticker or name contains the query (case-insensitive); an empty query keeps them all. */
export function searchCompanies<T extends Pick<Company, 'ticker' | 'name'>>(companies: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return companies;
  return companies.filter((c) => c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
}

export type SourceLink = { url: string; title: string; date: string };

/** Source links for a pick or company outlook: web links only, de-duplicated, with a title when the run gave one. */
export function pickSources(item: Pick<MonthlyPick | CompanyOutlook, 'sourceUrls' | 'sourceDetails'>): SourceLink[] {
  const raw: SourceLink[] = item.sourceDetails?.length
    ? item.sourceDetails.map((s) => ({ url: s.url, title: s.title, date: s.date }))
    : (item.sourceUrls ?? []).map((url) => ({ url, title: '', date: '' }));
  const seen = new Set<string>();
  const out: SourceLink[] = [];
  for (const s of raw) {
    let host: string;
    try {
      const u = new URL(s.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      host = u.hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ url: s.url, title: s.title?.trim() || host, date: s.date ?? '' });
  }
  return out;
}
