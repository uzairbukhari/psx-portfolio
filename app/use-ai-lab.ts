'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { watchQuery } from '@/lib/market-watch';
import { reportUsable } from '@/lib/ai-research/reuse';
import type { PublicResearch } from '@/lib/ai-research/types';

export type ResearchState = 'ready' | 'carried' | 'queued' | 'researching' | 'failed' | 'stale' | 'none';
export const STATE_LABEL: Record<ResearchState, string> = {
  ready: 'Researched', carried: 'Reused from earlier', queued: 'Queued', researching: 'Researching…', failed: 'Failed', stale: 'Out of date', none: 'No research',
};
const POLL_MS = 15_000;
const POLL_LIMIT_MS = 45 * 60_000;

async function readJson<T>(response: Response): Promise<T & { error?: string }> {
  try { return (await response.json()) as T & { error?: string }; } catch { throw Error(`Request failed (${response.status}).`); }
}

/** Public AI research for the named tickers (super admin API). Polls while a request is queued or running. */
export function useAiLabResearch(tickers: string[]) {
  const key = useMemo(() => [...tickers].sort().join(','), [tickers]);
  const [data, setData] = useState<PublicResearch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = key ? key.split(',') : [];
    const response = await fetch(`/api/ai-lab/research?${watchQuery(list)}`, { cache: 'no-store' });
    const body = await readJson<PublicResearch>(response);
    if (!response.ok) throw Error(body.error ?? 'Could not load AI Lab research.');
    setData(body);
    return body;
  }, [key]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().then(() => setError(null), (cause) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setLoaded(true));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const working = !!data?.requests.some((r) => r.status === 'queued' || r.status === 'researching');
  useEffect(() => {
    if (!working) return;
    const began = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - began > POLL_LIMIT_MS) { window.clearInterval(timer); return; }
      void load().catch(() => {});
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [working, load]);

  const request = useCallback(async (list: string[]) => {
    setRequesting(true);
    setNotice(null);
    try {
      const response = await fetch('/api/ai-lab/research', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: list }),
      });
      const body = await readJson<{ queued: string[]; dispatched: boolean; reason: string | null }>(response);
      if (!response.ok) throw Error(body.error ?? 'Could not request research.');
      setNotice(body.dispatched ? `Research started for ${body.queued.length} companies. It can take 10 to 30 minutes.` : body.reason);
      setError(null);
      await load().catch(() => {});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRequesting(false);
    }
  }, [load]);

  const stateOf = useCallback((ticker: string): ResearchState => {
    const stored = data?.reports.find((r) => r.ticker === ticker);
    const req = data?.requests.find((r) => r.ticker === ticker);
    if (req?.status === 'researching' || req?.status === 'queued') return req.status;
    if (stored) return reportUsable(stored, new Date()) ? (stored.carriedForward ? 'carried' : 'ready') : 'stale';
    return req?.status === 'failed' ? 'failed' : 'none';
  }, [data]);

  return { data, error, setError, loaded, requesting, notice, working, request, reload: load, stateOf };
}
