// AI Lab picks, built on the device from the public research and the user's own holdings. The server never sees the
// amount, holdings or shortlist beyond the ticker list used to fetch the research; this runs where the portfolio is
// decrypted. Sizing reuses the same 35% / 20% limits as Monthly Picks (lib/monthly-picks-allocation.ts).
import { applySizing, type HoldingValue } from './monthly-picks-allocation.ts';
import { estimateMonthlyPicks, type MonthlyPick, type MonthlyPickEstimate, type MonthlyPicksResearch } from './monthly-picks.ts';
import { reportUsable } from './ai-research/reuse.ts';
import type { PublicResearch, StoredReport } from './ai-research/types.ts';
import { AI_LAB_VERSION, type AiLabPick, type AiLabResult } from './ai-lab-types.ts';
import type { Portfolio } from './portfolio.ts';

export const MIN_CONVICTION = 55;
export const MAX_PICKS = 5;

export type AiLabInput = {
  shortlist: string[];
  research: PublicResearch;
  names: Record<string, string>;
  quantScores?: Record<string, number>;
  holdings: HoldingValue[];
  amount: number;
  now?: Date;
};

/** Why a researched company is not eligible for new money, or null when it is. */
export function ineligibleReason(stored: StoredReport | undefined, now: Date): string | null {
  if (!stored) return 'No AI research yet. Prepare research for this company.';
  if (!reportUsable(stored, now)) return 'The research is out of date or its sources did not check out. Prepare research again.';
  const c = stored.report;
  if (c.holdingView.thesisState === 'broken') return 'The case for owning this company looks broken, so it is not a candidate for new money.';
  if (c.conviction < MIN_CONVICTION) return `Conviction ${c.conviction} is below ${MIN_CONVICTION}.`;
  if (!(c.expectedReturn.basePct > 0)) return 'The expected 3-month return is not positive.';
  return null;
}

export function buildAiLabResult(input: AiLabInput): AiLabResult {
  const now = input.now ?? new Date();
  const byTicker = new Map(input.research.reports.map((r) => [r.ticker, r]));
  const ranking = input.research.ranking;
  const rankOf = new Map((ranking?.entries ?? []).map((e) => [e.ticker, e]));
  const excluded: AiLabResult['excluded'] = [];
  const eligible: StoredReport[] = [];
  for (const ticker of input.shortlist) {
    const reason = ineligibleReason(byTicker.get(ticker), now);
    if (reason) excluded.push({ ticker, reason });
    else eligible.push(byTicker.get(ticker)!);
  }
  // Order by the model's ranking when it covers the company, otherwise by conviction; keep the best five.
  const ordered = [...eligible].sort((a, b) => {
    const ra = rankOf.get(a.ticker)?.rank ?? Infinity;
    const rb = rankOf.get(b.ticker)?.rank ?? Infinity;
    return ra !== rb ? ra - rb : b.report.conviction - a.report.conviction;
  });
  for (const dropped of ordered.slice(MAX_PICKS)) excluded.push({ ticker: dropped.ticker, reason: `Ranked below the top ${MAX_PICKS} of your shortlist.` });
  const top = ordered.slice(0, MAX_PICKS);
  // Model weight when the ranking has one; otherwise a share of 100 proportional to conviction.
  const convictionTotal = top.reduce((s, r) => s + r.report.conviction, 0) || 1;
  const weights = top.map((r) => {
    const w = rankOf.get(r.ticker)?.modelWeightPct;
    return w && w > 0 ? w : Math.round((r.report.conviction / convictionTotal) * 1000) / 10;
  });
  const picks: AiLabPick[] = top.map((r, i) => ({
    ticker: r.ticker, name: input.names[r.ticker] ?? r.ticker, rank: i + 1,
    allocationPct: Math.min(35, weights[i]),
    conviction: rankOf.get(r.ticker)?.conviction ?? r.report.conviction,
    expectedReturn: r.report.expectedReturn, thesis: r.report.thesis, bullCase: r.report.bullCase, bearCase: r.report.bearCase,
    bearReviewNote: r.report.bearReviewNote, catalysts: r.report.catalysts, risks: r.report.risks, evidence: r.report.evidence,
    note: rankOf.get(r.ticker)?.note ?? '', thesisState: r.report.holdingView.thesisState,
    researchedAt: r.researchedAt, carriedForward: r.carriedForward, quantScore: input.quantScores?.[r.ticker] ?? null,
  }));
  const allocated = picks.reduce((s, p) => s + p.allocationPct, 0);
  const base: AiLabResult = {
    picks, excluded, unallocatedPct: Math.max(0, Math.round((100 - allocated) * 100) / 100),
    outlook: ranking?.outlook ?? '', macroSummary: input.research.macro?.summary ?? '',
    dataAsOf: now.toISOString().slice(0, 10), rankingMonth: ranking?.month ?? null, version: AI_LAB_VERSION,
  };
  return picks.length && input.amount > 0 ? applySizing(base, input.holdings, input.amount, now) : base;
}

const confidenceOf = (conviction: number): MonthlyPick['confidence'] => (conviction >= 72 ? 'High' : conviction >= 60 ? 'Medium' : 'Low');

/** Whole-share estimates from dated PSX quotes, through the same code Monthly Picks uses. */
export function estimateAiLabBuys(result: AiLabResult, portfolio: Portfolio, amount: number, feePct: number, now = new Date()): MonthlyPickEstimate[] {
  const asPicks: MonthlyPicksResearch = {
    marketOutlook: result.outlook,
    picks: result.picks.map((p) => ({
      ticker: p.ticker, name: p.name, allocationPct: p.allocationPct, confidence: confidenceOf(p.conviction), thesis: p.thesis,
      catalysts: p.catalysts.map((c) => c.text), risks: p.risks, sourceUrls: [], evidenceStatus: 'ready' as const,
    })),
    coverage: [], unallocatedPct: result.unallocatedPct,
  };
  return estimateMonthlyPicks(asPicks, portfolio, amount, feePct, now);
}

export function recordAiLabRun<T extends { id: string }>(existing: T[] | undefined, run: T, max = 12): T[] {
  return [run, ...(existing ?? []).filter((item) => item.id !== run.id)].slice(0, max);
}
