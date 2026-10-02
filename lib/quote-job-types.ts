// Types and fixed wording of the manual price refresh job. No imports, so the mobile app can share it.
export type QuoteOutcome = 'updated' | 'already_current' | 'fallback_used' | 'failed';
export type QuoteJobState = 'idle' | 'fresh' | 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'unavailable';

export interface QuoteJob {
  state: QuoteJobState;
  /** Tickers this job covers. */
  tickers: string[];
  /** Verified per-ticker result once a ticker's request has finished. */
  outcomes: Record<string, QuoteOutcome>;
  /** Tickers still queued or running. */
  pending: string[];
  /** The one user-facing line for the state; null while idle. */
  message: string | null;
  /** Earliest request time of the job: pass it back as `since` when polling. */
  requestedAt?: string;
}

/** The only wording users see for a manual refresh. */
export const QUOTE_MESSAGES = {
  pending: 'Refreshing market prices…',
  updated: 'Market prices refreshed successfully.',
  fresh: 'Market prices are already up to date.',
  partial: 'Some prices could not be refreshed. Previous prices have been retained.',
  failed: 'Unable to refresh market prices right now. Please try again later.',
} as const;
/** Per-ticker notes next to a price; never a status code, provider or scraper detail. */
export const QUOTE_NOTES = { retained: 'Previous price retained.', missing: 'Price not available yet.' } as const;

