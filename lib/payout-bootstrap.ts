// Companies whose payout history has never been fetched: no on-demand fetch on record and no cached announcement.
// The app asks for these once when it opens, so a newly added company does not wait for the next scheduled scrape.
// Public tickers only; the server never learns which of them the user holds beyond the names the client sends.
import type { DividendRefreshResponse } from './api-types.ts';

export function tickersNeedingFirstFetch(data: Pick<DividendRefreshResponse, 'tickers' | 'states' | 'announcements' | 'dispatchEnabled'>): string[] {
  if (!data.dispatchEnabled) return [];
  const cached = new Set(data.announcements.map((a) => a.ticker));
  const state = new Map(data.states.map((s) => [s.ticker, s.state]));
  return data.tickers.filter((t) => (state.get(t) ?? 'none') === 'none' && !cached.has(t));
}
