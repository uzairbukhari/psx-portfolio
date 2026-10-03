// Monthly Picks, computed on the device. The server only supplies public analysis for the tickers the client
// names (lib/public-analysis.ts); the amount, fee estimate, shortlist, holdings and the finished result never
// leave the device unencrypted. Ranking is the deterministic quant score. There is no AI ranking, because that
// would send the user's money and holdings to a provider.
import { holdings, today, type Portfolio } from './portfolio.ts';
import { applySizing, type HoldingValue } from './monthly-picks-allocation.ts';
import { quantResult, WORKFLOW_VERSION, type SnapshotV8 } from './monthly-picks-ai.ts';
import type { MonthlyPicksResearch } from './monthly-picks.ts';
import type { PublicAnalysis } from './public-analysis-types.ts';

export const MAX_STORED_RUNS = 12;
export const LOCAL_METHOD = 'quant' as const;

/** A finished run as kept inside the encrypted portfolio. */
export type StoredPicksRun = {
  id: string;
  month: string;
  amount: number;
  feePct: number;
  shortlist: string[];
  status: 'completed' | 'failed';
  result: MonthlyPicksResearch | null;
  error: string | null;
  model: string;
  estimatedCostUsd: number | null;
  createdAt: string;
  updatedAt: string;
  workflowVersion: number;
  method: 'quant';
  dataAsOf: string | null;
};

export type LocalRunInput = {
  analysis: PublicAnalysis;
  month: string;
  amount: number;
  feePct: number;
  shortlist: string[];
  holdings: HoldingValue[];
  now?: Date;
  id?: string;
};

/** Existing positions with a ledger-derived quantity, valued at their saved quote (null = no usable valuation). */
export function heldValues(portfolio: Portfolio): HoldingValue[] {
  return holdings(portfolio).filter((h) => h.shares > 0).map((h) => ({ ticker: h.ticker, valuePkr: h.value }));
}

function snapshotFor(input: LocalRunInput, day: string): SnapshotV8 {
  const wanted = new Set(input.shortlist);
  return {
    generatedOn: day,
    contributionMonth: input.month,
    freshMoneyPkr: input.amount,
    shortlist: [...input.shortlist],
    dataAsOf: input.analysis.dataAsOf,
    companies: input.analysis.companies.filter((company) => wanted.has(company.ticker)),
    scores: input.analysis.scores.filter((score) => wanted.has(score.ticker)),
  };
}

/** Ranks the shortlist from public data and sizes it against the user's own holdings. Pure; never throws on bad data. */
export function runLocalPicks(input: LocalRunInput): StoredPicksRun {
  const now = input.now ?? new Date();
  const at = now.toISOString();
  const base = {
    id: input.id ?? crypto.randomUUID(), month: input.month, amount: input.amount, feePct: input.feePct,
    shortlist: [...input.shortlist], model: 'quant', estimatedCostUsd: 0, createdAt: at, updatedAt: at,
    workflowVersion: WORKFLOW_VERSION, method: LOCAL_METHOD, dataAsOf: input.analysis.dataAsOf,
  };
  const snapshot = snapshotFor(input, at.slice(0, 10));
  const usable = snapshot.companies.filter((company) => !company.metrics.unavailable);
  if (!usable.length) {
    const reasons = snapshot.companies.slice(0, 3).map((company) => `${company.ticker}: ${company.metrics.unavailable}`).join(' ');
    return { ...base, status: 'failed', result: null, error: `No shortlisted company has usable PSX data yet. ${reasons}`.slice(0, 600) };
  }
  const unsized = quantResult(snapshot);
  const result = applySizing(unsized, input.holdings, input.amount, now);
  return { ...base, status: 'completed', result, error: null };
}

/** Newest first, de-duplicated by id, bounded. */
export function recordRun(existing: StoredPicksRun[] | undefined, run: StoredPicksRun): StoredPicksRun[] {
  return [run, ...(existing ?? []).filter((item) => item.id !== run.id)].slice(0, MAX_STORED_RUNS);
}

export const sameDay = (run: StoredPicksRun, day = today()) => run.dataAsOf === day;
