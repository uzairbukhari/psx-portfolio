'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Portfolio } from '@/lib/portfolio';
import type { PublicAnalysisResponse } from '@/lib/api-types';
import { parsePublicAnalysis, pollIntervalMs } from '@/lib/api-validate';
import type { RunProgress } from '@/lib/monthly-picks-progress';
import { heldValues, recordRun, type StoredPicksRun } from '@/lib/picks-local';
import { executePicksRun } from '@/lib/picks-run';
import { watchQuery } from '@/lib/market-watch';
import { track } from './analytics';

/** Runs are computed on this device and live in the encrypted portfolio, so every saved run is finished. */
export type RunStatus = 'completed' | 'failed';
export type Recommendation = StoredPicksRun;
export type FactsState = 'fresh' | 'stale' | 'missing' | 'failed';
export type FactsInfo = { ticker: string; state: FactsState; fetchedOn: string | null; ageDays: number | null; error: string | null };
export type RunInput = { month: string; amount: number; feePct: number; shortlist: string[]; rerun: boolean };

async function json<T>(response: Response): Promise<T & { error?: string }> {
  try {
    return (await response.json()) as T & { error?: string };
  } catch {
    throw Error(`Request failed (${response.status}).`);
  }
}

async function fetchAnalysis(tickers: string[], signal?: AbortSignal): Promise<PublicAnalysisResponse> {
  const response = await fetch(`/api/recommendations?${watchQuery(tickers)}`, { cache: 'no-store', signal });
  const data = await json<PublicAnalysisResponse>(response);
  if (!response.ok) throw Error(data.error ?? 'Could not load company data.');
  const parsed = parsePublicAnalysis(data);
  if (!parsed) throw Error('The company data response was not understood.');
  return parsed;
}

type Options = {
  portfolio: Portfolio;
  /** The shortlist currently chosen in the form: the only thing the server is told, and only as tickers. */
  tickers: string[];
  onSave: (next: Portfolio, message?: string) => Promise<void>;
};

export function useRecommendations({ portfolio, tickers, onSave }: Options) {
  const history = portfolio.monthlyPicksRuns ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [facts, setFacts] = useState<Record<string, FactsInfo>>({});
  const [dispatchEnabled, setDispatchEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [watch, setWatch] = useState<string[]>([]);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const portfolioRef = useRef(portfolio);
  portfolioRef.current = portfolio;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const tickerKey = useMemo(() => [...tickers].sort().join(','), [tickers]);
  const current = history.find((run) => run.id === selectedId) ?? history[0] ?? null;

  const load = useCallback(async (list: string[]) => {
    if (!list.length) {
      setFacts({});
      return {} as Record<string, FactsInfo>;
    }
    const analysis = await fetchAnalysis(list);
    const byTicker = Object.fromEntries(analysis.facts.map((info) => [info.ticker, info as FactsInfo]));
    setFacts(byTicker);
    setDispatchEnabled(analysis.dispatchEnabled);
    return byTicker;
  }, []);

  useEffect(() => {
    const list = tickerKey ? tickerKey.split(',') : [];
    const timer = window.setTimeout(() => {
      void load(list)
        .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
        .finally(() => setLoaded(true));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [load, tickerKey]);

  // After an on-demand fetch, re-read facts until the requested tickers are fresh (max ~3 minutes).
  useEffect(() => {
    if (!watch.length) return;
    let rounds = 0;
    const timer = window.setInterval(() => {
      rounds += 1;
      void load(tickerKey ? tickerKey.split(',') : [])
        .then((latest) => {
          if (watch.every((ticker) => latest[ticker]?.state === 'fresh') || rounds >= 18) setWatch([]);
        })
        .catch(() => { if (rounds >= 18) setWatch([]); });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [watch, load, tickerKey]);

  const requestFacts = useCallback(async (list: string[]) => {
    const response = await fetch('/api/recommendations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh-facts', tickers: list }),
    });
    const data = await json<{ dispatched: boolean; waiting: boolean; reason: string | null }>(response);
    if (!response.ok) throw Error(data.error ?? 'Could not request fresh data.');
    return data;
  }, []);

  const refreshFacts = useCallback(async (list: string[]) => {
    const data = await requestFacts(list);
    if (data.waiting) setWatch(list);
    await load(list).catch(() => {});
    return data;
  }, [load, requestFacts]);

  /** Gathers public data (asking for a fresh scrape when needed), then ranks and sizes entirely on this device. */
  const start = useCallback(async (input: RunInput) => {
    setError(null);
    track('picks_run_started');
    try {
      const latest = portfolioRef.current;
      const { run, analysis } = await executePicksRun(
        {
          analysis: fetchAnalysis,
          requestFacts,
          sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
          now: () => Date.now(),
          pollMs: pollIntervalMs,
          onProgress: setProgress,
        },
        { month: input.month, amount: input.amount, feePct: input.feePct, shortlist: input.shortlist, holdings: heldValues(latest) },
      );
      const current = portfolioRef.current;
      await onSaveRef.current({ ...current, monthlyPicksRuns: recordRun(current.monthlyPicksRuns, run) }, 'Monthly Picks run saved.');
      setSelectedId(run.id);
      track('picks_run_completed');
      setFacts(Object.fromEntries(analysis.facts.map((info) => [info.ticker, info as FactsInfo])));
      return run;
    } catch (e) {
      track('picks_run_failed');
      throw e;
    } finally {
      setProgress(null);
    }
  }, [requestFacts]);

  return {
    history, current, facts, dispatchEnabled, loaded, error, setError,
    running: progress !== null, progress, refreshing: watch.length > 0,
    select: (run: Recommendation) => setSelectedId(run.id), start, refreshFacts,
  };
}
