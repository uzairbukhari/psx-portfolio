'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QuotesResponse } from '@/lib/api-types';
import type { Quote } from '@/lib/portfolio';
import { followQuoteJob, jobMessage, isPending } from '@/lib/quote-refresh-client';

async function call(tickers: string[], since?: string): Promise<QuotesResponse> {
  const response =
    since === undefined
      ? await fetch('/api/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) })
      : await fetch(`/api/quotes?tickers=${tickers.join(',')}${since ? `&since=${encodeURIComponent(since)}` : ''}`);
  const body = (await response.json().catch(() => ({}))) as QuotesResponse & { error?: string };
  if (!response.ok) throw Error(body.error || 'Prices could not be refreshed.');
  return body;
}

/**
 * PSX prices for the companies on the Monthly Picks list. They are public, shared quotes kept only in memory here:
 * a list company is not a saved company, so its price is never written into the portfolio.
 */
export function useListQuotes(tickers: string[]) {
  const key = useMemo(() => [...new Set(tickers)].sort().join(','), [tickers]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    const list = key.split(',').slice(0, 200);
    const timer = window.setTimeout(() => {
      call(list, '')
        .then((body) => alive.current && setQuotes((current) => ({ ...current, ...body.quotes })))
        .catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [key]);

  const refresh = useCallback(async () => {
    const list = key ? key.split(',').slice(0, 200) : [];
    if (!list.length) return;
    try {
      const final = await followQuoteJob({
        start: () => call(list),
        poll: (since) => call(list, since ?? ''),
        cancelled: () => !alive.current,
        onPending: (body) => alive.current && setQuotes((current) => ({ ...current, ...body.quotes })),
      });
      if (!alive.current) return;
      setQuotes((current) => ({ ...current, ...final.quotes }));
      setMessage(isPending(final.job) ? '' : final.job ? jobMessage(final.job) : '');
    } catch (error) {
      if (alive.current) setMessage(error instanceof Error ? error.message : 'Prices could not be refreshed.');
    }
  }, [key]);

  return { quotes, refresh, message };
}
