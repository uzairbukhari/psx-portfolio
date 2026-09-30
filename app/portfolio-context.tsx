'use client';
import { createContext, useContext } from 'react';
import type {
  Dividend,
  Portfolio,
  StockSplit,
  Trade,
} from '@/lib/portfolio';

/** Requests to open one of the shared ledger dialogs. Only one dialog is open at a time. */
export type DialogRequest =
  | { type: 'trade'; ticker?: string; kind?: 'buy' | 'sell'; editing?: Trade }
  | { type: 'dividend'; ticker?: string; editing?: Dividend }
  | { type: 'split'; ticker?: string; editing?: StockSplit }
  | { type: 'receipt'; dividend: Dividend }
  | { type: 'company'; ticker?: string }
  | { type: 'quote'; ticker: string };

export type ToastOptions = {
  title: string;
  description?: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  action?: { label: string; onClick: () => void };
};

export type PortfolioContextValue = {
  /** Latest loaded portfolio (always present inside the provider). */
  p: Portfolio;
  /** A save is in flight; dialogs disable their submit button. */
  saving: boolean;
  /** A price refresh is in flight. */
  refreshing: boolean;
  /** Saving or refreshing: anything that should block a second write. */
  busy: boolean;
  isAdmin: boolean;
  /** Saves `next`, adopting it as the current portfolio. Throws on failure. */
  save: (next: Portfolio) => Promise<void>;
  /** Re-reads the latest stored portfolio (used to recover from a save conflict). */
  reload: () => Promise<void>;
  /** The latest portfolio, even from a stale closure (toast actions, undo). */
  latest: () => Portfolio;
  notify: (message: string, error?: boolean) => void;
  toast: (options: ToastOptions) => void;
  openCompany: (ticker: string) => void;
  goTab: (tab: string) => void;
  openDialog: (request: DialogRequest) => void;
  refreshPrices: () => Promise<void>;
};

const PortfolioContext = createContext<PortfolioContextValue | null>(null);
export const PortfolioProvider = PortfolioContext.Provider;

export function usePortfolioContext(): PortfolioContextValue {
  const value = useContext(PortfolioContext);
  if (!value)
    throw Error('usePortfolioContext must be used inside <PortfolioProvider>.');
  return value;
}
