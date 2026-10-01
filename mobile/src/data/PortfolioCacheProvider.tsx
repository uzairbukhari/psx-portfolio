import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PortfolioResponse } from '@shared/api-types.ts';
import { readPortfolioCache } from './portfolio-cache';

const CacheContext = createContext<PortfolioResponse | null>(null);

/**
 * Reads the on-disk portfolio cache once per signed-in user and shares it with every screen, so mounting
 * another screen never reads (and parses) the file again.
 */
export function PortfolioCacheProvider({ email, children }: { email: string; children: ReactNode }) {
  const [cached, setCached] = useState<PortfolioResponse | null>(null);
  useEffect(() => {
    let live = true;
    setCached(null);
    if (email) void readPortfolioCache(email).then((c) => live && setCached(c));
    return () => {
      live = false;
    };
  }, [email]);
  return <CacheContext.Provider value={cached}>{children}</CacheContext.Provider>;
}

export const useCachedPortfolio = () => useContext(CacheContext);
