// When the phone should poll for market data: only while the PSX session is open (market-state rules are shared
// with the web) and the screen showing it is focused.
import { pakistanMarketState } from '../../../lib/psx-market.ts';

export const MARKET_POLL_MS = 60_000;

export const marketOpen = (at: Date = new Date()) => pakistanMarketState(at).isOpen;

/** True when a timer tick should refetch the market summary. */
export function shouldPollMarket(focused: boolean, at: Date = new Date()): boolean {
  return focused && marketOpen(at);
}
