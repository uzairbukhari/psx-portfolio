'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompaniesResponse, CompanyLookup } from '@/lib/api-types';
import { DEBOUNCE_MS, POLL_INTERVAL_MS, POLL_LIMIT_MS, createLatest, nextLookupAction } from '@/lib/company-lookup-client';

export type LookupView = {
  /** idle: no valid symbol; loading: checking; error: the check itself failed (retry); others mirror the server. */
  status: 'idle' | 'loading' | 'resolved' | 'pending' | 'unresolved' | 'error';
  ticker: string;
  company: CompanyLookup['company'];
  message: string | null;
};
const IDLE: LookupView = { status: 'idle', ticker: '', company: null, message: null };

async function call(url: string, init?: RequestInit): Promise<CompaniesResponse> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as CompaniesResponse & { error?: string };
  if (!response.ok) throw Error(body.error || 'Company details could not be checked.');
  return body;
}

/**
 * Looks a typed symbol up in the shared company directory: debounced, with the previous company cleared the
 * moment the symbol changes and replies for an older symbol discarded. An unknown symbol triggers one
 * background lookup (the server deduplicates), then polls until it resolves, fails, or the poll limit passes.
 */
export function useCompanyLookup(rawTicker: string): LookupView & { retry: () => void } {
  const ticker = rawTicker.trim().toUpperCase();
  const valid = /^[A-Z0-9]{2,12}$/.test(ticker);
  const [view, setView] = useState<LookupView>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(createLatest());

  useEffect(() => {
    const guard = latest.current;
    const id = guard.next();
    if (!valid) {
      setView(IDLE);
      return;
    }
    setView({ status: 'loading', ticker, company: null, message: null });
    let timer: number | undefined;
    const startedAt = Date.now();
    let requested = false;
    const show = (lookup: CompanyLookup, message?: string) =>
      setView({ status: lookup.state, ticker, company: lookup.company, message: message ?? lookup.message });
    async function step() {
      try {
        let body = await call(`/api/companies?tickers=${encodeURIComponent(ticker)}`);
        if (!guard.isCurrent(id)) return;
        let result = body.companies[0];
        if (nextLookupAction(result, requested) === 'request') {
          requested = true;
          body = await call('/api/companies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: [ticker] }) });
          if (!guard.isCurrent(id)) return;
          result = body.companies[0];
        }
        if (!result) return setView({ status: 'error', ticker, company: null, message: 'Company details could not be checked.' });
        show(result);
        if (result.state === 'pending' && Date.now() - startedAt < POLL_LIMIT_MS) timer = window.setTimeout(() => void step(), POLL_INTERVAL_MS);
        else if (result.state === 'pending') setView({ status: 'unresolved', ticker, company: null, message: 'Still looking. Try again in a few minutes.' });
      } catch (error) {
        if (guard.isCurrent(id)) setView({ status: 'error', ticker, company: null, message: error instanceof Error ? error.message : 'Company details could not be checked.' });
      }
    }
    const debounce = window.setTimeout(() => void step(), DEBOUNCE_MS);
    return () => {
      guard.cancel();
      window.clearTimeout(debounce);
      if (timer) window.clearTimeout(timer);
    };
  }, [ticker, valid, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...view, retry };
}
