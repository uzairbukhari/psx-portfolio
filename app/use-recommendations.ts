'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MonthlyPicksResearch } from '@/lib/monthly-picks';
import type { RecommendationProgress } from '@/lib/api-types';
import { pollIntervalMs } from '@/lib/api-validate';

export type RunStatus =
  | 'queued' | 'gathering' | 'in_progress' | 'completed' | 'failed'
  // Only on rows saved by earlier workflows; shown read-only.
  | 'completed_partial' | 'needs_evidence' | 'needs_attention';

export type Recommendation = {
  id: string;
  month: string;
  amount: number;
  feePct: number;
  shortlist: string[];
  status: RunStatus;
  result: MonthlyPicksResearch | null;
  error: string | null;
  model: string;
  estimatedCostUsd: number | null;
  createdAt: string;
  updatedAt: string;
  workflowVersion?: number;
  method?: 'ai' | 'quant';
  dataAsOf?: string;
  progress?: RecommendationProgress;
};

export type FactsState = 'fresh' | 'stale' | 'missing' | 'failed';
export type FactsInfo = { ticker: string; state: FactsState; fetchedOn: string | null; ageDays: number | null; error: string | null };

export type RunInput = { month: string; amount: number; feePct: number; shortlist: string[]; rerun: boolean };

export const isActive = (status?: string) => status === 'queued' || status === 'gathering' || status === 'in_progress';

type ListResponse = {
  recommendations?: Recommendation[];
  facts?: FactsInfo[];
  dispatchEnabled?: boolean;
  error?: string;
};

async function json<T>(response: Response): Promise<T & { error?: string }> {
  try {
    return (await response.json()) as T & { error?: string };
  } catch {
    throw Error(`Request failed (${response.status}).`);
  }
}

export function useRecommendations() {
  const [history, setHistory] = useState<Recommendation[]>([]);
  const [current, setCurrent] = useState<Recommendation | null>(null);
  const [facts, setFacts] = useState<Record<string, FactsInfo>>({});
  const [dispatchEnabled, setDispatchEnabled] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watch, setWatch] = useState<string[]>([]);

  const load = useCallback(async () => {
    const response = await fetch('/api/recommendations', { cache: 'no-store' });
    const data = await json<ListResponse>(response);
    if (!response.ok) throw Error(data.error ?? 'Could not load recommendations.');
    const rows = data.recommendations ?? [];
    const byTicker = Object.fromEntries((data.facts ?? []).map((info) => [info.ticker, info]));
    setHistory(rows);
    setFacts(byTicker);
    setDispatchEnabled(Boolean(data.dispatchEnabled));
    setCurrent((value) => value ?? rows[0] ?? null);
    const running = rows.find((row) => isActive(row.status));
    if (running) setActiveId(running.id);
    setLoaded(true);
    return byTicker;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause) => {
        setLoaded(true);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Poll the active run: fast while it is moving, slower after a while, paused while the tab is hidden.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: number | undefined;
    const startedPolling = Date.now();
    let failures = 0;
    const controller = new AbortController();
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = window.setTimeout(() => void tick(), 3000);
        return;
      }
      try {
        const response = await fetch(`/api/recommendations?id=${encodeURIComponent(activeId)}`, { cache: 'no-store', signal: controller.signal });
        const data = await json<Recommendation>(response);
        if (!response.ok) throw Error(data.error ?? 'Could not read the run.');
        if (cancelled) return;
        failures = 0;
        setCurrent(data);
        if (!isActive(data.status)) {
          setActiveId(null);
          await load().catch(() => {});
          return;
        }
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return;
        failures += 1;
        if (failures >= 5) {
          setActiveId(null);
          setError(cause instanceof Error ? cause.message : String(cause));
          return;
        }
      }
      timer = window.setTimeout(() => void tick(), pollIntervalMs(Date.now() - startedPolling));
    };
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeId, load]);

  // After an on-demand fetch, re-read facts until the requested tickers are fresh (max ~3 minutes).
  useEffect(() => {
    if (!watch.length) return;
    let rounds = 0;
    const timer = window.setInterval(() => {
      rounds += 1;
      void load()
        .then((latest) => {
          if (watch.every((ticker) => latest[ticker]?.state === 'fresh') || rounds >= 18) setWatch([]);
        })
        .catch(() => { if (rounds >= 18) setWatch([]); });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [watch, load]);

  const start = useCallback(async (input: RunInput) => {
    setError(null);
    const response = await fetch('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await json<Recommendation>(response);
    if (!response.ok) throw Error(data.error ?? 'Could not start the run.');
    setCurrent(data);
    if (isActive(data.status)) setActiveId(data.id);
    else await load().catch(() => {});
    return data;
  }, [load]);

  const refreshFacts = useCallback(async (tickers: string[]) => {
    const response = await fetch('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh-facts', tickers }),
    });
    const data = await json<{ dispatched: boolean; waiting: boolean; reason: string | null }>(response);
    if (!response.ok) throw Error(data.error ?? 'Could not request fresh data.');
    if (data.waiting) setWatch(tickers);
    await load().catch(() => {});
    return data;
  }, [load]);

  return {
    history, current, facts, dispatchEnabled, loaded, error, setError,
    running: activeId !== null, refreshing: watch.length > 0,
    select: setCurrent, start, refreshFacts,
  };
}
