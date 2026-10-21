'use client';
// The KSE-100 card and the Today column on Holdings. Same public answer as the market pulse (`/api/market-summary`),
// read once and then every two minutes while the page is visible and PSX is in session; names and saved quotes are folded in on the device.
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

/** Mon-Fri 09:00-16:45 Pakistan time, a little wider than the trading hours. Outside it the answer cannot change. */
function sessionWindow(now = new Date()) {
  const pkt = new Date(now.getTime() + 5 * 3_600_000);
  const day = pkt.getUTCDay();
  const minutes = pkt.getUTCHours() * 60 + pkt.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 16 * 60 + 45;
}

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
    // Prices only move while PSX trades: outside the session there is nothing new to ask for every two minutes.
    const timer = window.setInterval(() => {
      if (!document.hidden && sessionWindow()) void load();
    }, 120_000);
    // Coming back to the tab after a while shows the latest answer once.
    let hiddenAt = 0;
    const visible = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 120_000) void load();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [key]);
  return glance;
}
