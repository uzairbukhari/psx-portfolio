import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readPortfolioCache, type CachedPortfolio } from './portfolio-cache';

const CacheContext = createContext<CachedPortfolio | null>(null);

/**
 * Reads the on-disk portfolio cache once per signed-in user and shares it with every screen, so mounting
 * another screen never reads (and parses) the file again.
 */
export function PortfolioCacheProvider({ email, children }: { email: string; children: ReactNode }) {
  const [cached, setCached] = useState<CachedPortfolio | null>(null);
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

/** The saved portfolio response, or null before it is read (or when there is none). */
export const useCachedPortfolio = () => useContext(CacheContext)?.data ?? null;
/** When the saved copy was written, in ms since epoch (null if unknown). */
export const useCachedSavedAt = () => useContext(CacheContext)?.savedAt ?? null;
