// Types of the experimental AI Lab as stored in the encrypted portfolio and shown by the tab. Kept apart from the
// Monthly Picks types, which AI Lab does not change.
import type { MonthlyPicksSizing } from './monthly-picks-allocation.ts';
import type { ReportCatalyst, ReportEvidence, ThesisState } from './ai-research/types.ts';

export const AI_LAB_VERSION = 1;
export const MAX_AI_LAB_RUNS = 12;

export type AiLabPick = {
  ticker: string;
  name: string;
  rank: number;
  allocationPct: number;
  conviction: number;
  expectedReturn: { lowPct: number; basePct: number; highPct: number; horizonDays: number };
  thesis: string;
  bullCase: string;
  bearCase: string;
  bearReviewNote?: string;
  catalysts: ReportCatalyst[];
  risks: string[];
  evidence: ReportEvidence[];
  note: string;
  thesisState: ThesisState;
  researchedAt: string;
  carriedForward: boolean;
  /** The deterministic Monthly Picks score for the same company, shown beside the AI view. */
  quantScore: number | null;
};
export type AiLabResult = {
  picks: AiLabPick[];
  excluded: { ticker: string; reason: string }[];
  unallocatedPct: number;
  outlook: string;
  macroSummary: string;
  dataAsOf: string;
  rankingMonth: string | null;
  sizing?: MonthlyPicksSizing;
  version: number;
};
export type AiLabRun = {
  id: string;
  month: string;
  amount: number;
  feePct: number;
  shortlist: string[];
  createdAt: string;
  result: AiLabResult;
};

export type HoldingAction = 'keep' | 'add' | 'trim' | 'sell' | 'review';
export type HoldingSuggestion = {
  ticker: string;
  name: string;
  action: HoldingAction;
  reasons: string[];
  watch: string;
  weightPct: number | null;
  gainPct: number | null;
  conviction: number | null;
  thesisState: ThesisState | null;
  /** Shares to sell to get back to the concentration limit (trim only). */
  trimShares: number | null;
  sources: { label: string; url: string }[];
  researchedAt: string | null;
  carriedForward: boolean;
};
