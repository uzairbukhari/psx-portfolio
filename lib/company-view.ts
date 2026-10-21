// What the Company page needs beyond the holding itself: its weight in the stocks you hold, the profit already
// realised, the dividend totals with their running total, and the buy/sell dots drawn on the price chart.
// Pure (no React, no clock, no I/O) so the web page and the phone work out the same figures from the same ledger.
import { holdings, realizedSales, taxSummary, type Portfolio, type Trade } from './portfolio.ts';

/** Share of the stocks you hold that sits in one company, 0 to 1; null when the value is not known. */
export function weightInStocks(portfolio: Portfolio, value: number | null): number | null {
  if (value === null) return null;
  let total = 0;
  try {
    for (const h of holdings(portfolio)) total += h.value ?? 0;
  } catch {
    return null;
  }
  return total > 0 ? value / total : null;
}

/** Profit on shares already sold. 0 when nothing was sold, null when any sale has no cost basis. */
export function realisedProfit(portfolio: Portfolio, ticker: string): number | null {
  try {
    const sales = realizedSales(portfolio).filter((x) => x.ticker === ticker);
    if (!sales.length) return 0;
    if (sales.some((x) => x.realizedGain === null)) return null;
    return Math.round(sales.reduce((a, x) => a + (x.realizedGain ?? 0), 0) * 100) / 100;
  } catch {
    return null;
  }
}

export type DividendPayment = { id: string; date: string; month: string; net: number; gross: number; total: number };

/**
 * Dividends received for one company, oldest first, each with the running total, for the per-payment bars and the
 * cumulative line. `net` falls back to gross when the tax is unknown (no filer status).
 */
export function dividendPayments(portfolio: Portfolio, ticker: string): DividendPayment[] {
  let rows: ReturnType<typeof taxSummary>['dividends'];
  try {
    rows = taxSummary(portfolio).dividends;
  } catch {
    return [];
  }
  let total = 0;
  return rows
    .filter((d) => d.ticker === ticker && d.status !== 'expected')
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      const net = d.netAmount ?? d.grossAmount;
      total = Math.round((total + net) * 100) / 100;
      return { id: d.id, date: d.date, month: d.date.slice(0, 7), net: Math.round(net * 100) / 100, gross: d.grossAmount, total };
    });
}

export type TradeMarker = { x: number; y: number; kind: 'buy' | 'sell'; label: string };

/** Noon PKT of a trade date in unix seconds, so a dot sits in the middle of its day on the chart. */
export const tradeSeconds = (date: string) => Math.round(Date.parse(`${date}T12:00:00+05:00`) / 1000);

/**
 * Your buys and sales as chart dots, for the window [from, to] in unix seconds. Openings and voided trades carry no
 * price, so they are left out. `money` formats the price in the label ("Bought 50 at Rs 305.00 · 2026-08-22").
 */
export function tradeMarkers(
  trades: readonly Trade[],
  ticker: string,
  from: number | undefined,
  to: number | undefined,
  money: (n: number) => string,
): TradeMarker[] {
  if (from === undefined || to === undefined) return [];
  return trades
    .filter((t) => t.ticker === ticker && !t.voided && t.price !== null && t.kind !== 'opening')
    .map((t) => ({ t, x: tradeSeconds(t.date) }))
    .filter(({ x }) => x >= from && x <= to)
    .map(({ t, x }) => ({
      x,
      y: t.price as number,
      kind: t.kind === 'sell' ? ('sell' as const) : ('buy' as const),
      label: `${t.kind === 'sell' ? 'Sold' : 'Bought'} ${t.shares} at ${money(t.price as number)} · ${t.date}`,
    }));
}
