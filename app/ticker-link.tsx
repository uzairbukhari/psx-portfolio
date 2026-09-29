'use client';

import { createContext, useContext, type MouseEvent, type ReactNode } from 'react';

const CompanyNavContext = createContext<((ticker: string) => void) | null>(null);

export const CompanyNavProvider = CompanyNavContext.Provider;

/** Ticker that opens /company/<TICKER>. Plain clicks stay in the SPA; modified clicks use the real link. */
export function TickerLink({
  ticker,
  className,
  children,
}: {
  ticker: string;
  className?: string;
  children?: ReactNode;
}) {
  const open = useContext(CompanyNavContext);
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    event.stopPropagation();
    if (!open || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    open(ticker);
  }
  return (
    <a
      href={`/company/${encodeURIComponent(ticker)}`}
      className={`ticker-link${className ? ` ${className}` : ''}`}
      onClick={onClick}
    >
      {children ?? ticker}
    </a>
  );
}
