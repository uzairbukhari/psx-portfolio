'use client';
// The KSE-100 card and the Today column on Holdings. Same public answer as the market pulse (`/api/market-summary`),
// read once and then every two minutes while the page is visible; names and saved quotes are folded in on the device.
import { useEffect, useRef, useState } from 'react';
import type { IndexPoint, IndexSummary, MarketState, ShortlistPerformance } from '@/lib/psx-market';
import type { MarketBreadthView } from '@/lib/api-types';
import type { Portfolio, Quote } from '@/lib/portfolio';
import { applyLocalWatch, watchQuery } from '@/lib/market-watch';
import { readJson } from '@/lib/safe-json';

export type MarketGlance = {
  index: IndexSummary | null;
  breadth: MarketBreadthView | null;
  series: IndexPoint[];
  companies: ShortlistPerformance[];
  market: MarketState | null;
};

const EMPTY: MarketGlance = { index: null, breadth: null, series: [], companies: [], market: null };

export function useMarketGlance(tickers: string[], names: Record<string, string>, saved: Portfolio['quotes']): MarketGlance {
  const [glance, setGlance] = useState<MarketGlance>(EMPTY);
  const watch = useRef({ names, saved });
  watch.current = { names, saved };
  const key = tickers.join(',');
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const query = watchQuery(key ? key.split(',') : []);
        const res = await fetch(`/api/market-summary${query ? `?${query}` : ''}`);
        const body = (await readJson(res)) as {
          summary?: {
            index: IndexSummary | null;
            breadth?: MarketBreadthView | null;
            series: IndexPoint[];
            companies: ShortlistPerformance[];
            quotes?: Record<string, Quote>;
            market: MarketState;
          };
        };
        if (!live || !res.ok || !body.summary) return;
        const s = body.summary;
        setGlance({
          index: s.index,
          breadth: s.breadth ?? null,
          series: s.series ?? [],
          companies: applyLocalWatch(s.companies, watch.current.names, watch.current.saved, s.quotes),
          market: s.market,
        });
      } catch {}
    };
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 120_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [key]);
  return glance;
}
