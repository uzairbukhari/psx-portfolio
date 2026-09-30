'use client';
import { useMemo } from 'react';
import { lastTradingDay, subtractTradingDays } from '@/lib/psx-calendar';
import { holdings, round, taxSummary, today, type Portfolio } from '@/lib/portfolio';

export type Holding = ReturnType<typeof holdings>[number];

/** Everything the Overview derives from the ledger, computed once per portfolio change. */
export function usePortfolioSummary(p: Portfolio) {
  return useMemo(() => {
    const hs = holdings(p)
      .slice()
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    const held = hs.filter((h) => h.shares > 0);
    const missing = held.filter((h) => !h.quote);
    const unknown = held.filter((h) => h.cost === null);
    const value = round(held.reduce((a, h) => a + (h.value ?? 0), 0));
    const cost = unknown.length
      ? null
      : round(held.reduce((a, h) => a + (h.cost ?? 0), 0));
    const gain = cost === null || missing.length ? null : round(value - cost);
    const newBuys = round(
      p.trades
        .filter((t) => t.kind === 'buy' && !t.voided)
        .reduce((a, t) => a + t.shares * t.price! + t.fees, 0),
    );
    const boughtTickers = new Set(
      p.trades.filter((t) => t.kind === 'buy' && !t.voided).map((t) => t.ticker),
    );
    const soldOut = hs.filter((h) => h.shares === 0 && boughtTickers.has(h.ticker));
    const sectorsInUse = Array.from(
      new Set(hs.map((h) => h.sector).filter((s): s is string => !!s)),
    );
    const taxedDividends = taxSummary(p).dividends;
    // A quote older than the previous trading session counts as stale (weekends and holidays skipped).
    const staleBefore = subtractTradingDays(lastTradingDay(today()), 1);
    const stale = held.filter((h) => h.quote && h.quote.date < staleBefore);
    const expectedDividends = taxedDividends.filter((d) => d.status === 'expected');
    return {
      hs,
      held,
      missing,
      unknown,
      stale,
      value,
      cost,
      gain,
      newBuys,
      soldOut,
      sectorsInUse,
      taxedDividends,
      expectedDividends,
    };
  }, [p]);
}
