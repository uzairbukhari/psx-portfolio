// AI Lab picks, built on the device from the public research and the user's own holdings. The server never sees the
// amount, holdings or shortlist beyond the ticker list used to fetch the research; this runs where the portfolio is
// decrypted. Sizing reuses the same 35% / 20% limits as Monthly Picks (lib/monthly-picks-allocation.ts).
import { applySizing, type HoldingValue } from './monthly-picks-allocation.ts';
import { estimateMonthlyPicks, type MonthlyPick, type MonthlyPickEstimate, type MonthlyPicksResearch } from './monthly-picks.ts';
import { reportUsable } from './ai-research/reuse.ts';
import { aiConviction, effectiveConviction } from './ai-research/verify.ts';
import type { PublicResearch, StoredReport } from './ai-research/types.ts';
import { AI_LAB_VERSION, type AiLabPick, type AiLabResult } from './ai-lab-types.ts';
import type { Portfolio } from './portfolio.ts';

/** 50 is a neutral expectation versus the KSE-100, so anything at or above it is not a negative view. */
export const MIN_CONVICTION = 50;
export const MAX_PICKS = 5;
/**
 * A monthly plan should not come back empty. When fewer than MIN_STRONG_PICKS companies clear MIN_CONVICTION, the best
 * of the rest (positive expected return, thesis not broken, conviction at least LOW_CONVICTION) fill the list, marked
 * as lower conviction and sized down so some of the money stays in cash.
 */
export const LOW_CONVICTION = 35;
export const MIN_STRONG_PICKS = 3;
const LOW_TIER_WEIGHT = 0.6;

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
export function ineligibleReason(stored: StoredReport | undefined, now: Date, floor = MIN_CONVICTION): string | null {
  if (!stored) return 'No AI research yet. Prepare research for this company.';
  if (!reportUsable(stored, now)) return 'The research is out of date or its sources did not check out. Prepare research again.';
  const c = stored.report;
  if (c.holdingView.thesisState === 'broken') return 'The case for owning this company looks broken, so it is not a candidate for new money.';
  const conviction = effectiveConviction(c.conviction, stored.verification);
  if (conviction < floor) {
    const ai = aiConviction(c.conviction, stored.verification);
    return `Conviction ${conviction} is below ${floor}${ai > conviction ? ` (the AI scored it ${ai}; unverified claims and the bear review took off ${ai - conviction})` : ''}.`;
  }
  if (!(c.expectedReturn.basePct > 0)) return 'The expected 3-month return is not positive.';
  return null;
}

export function buildAiLabResult(input: AiLabInput): AiLabResult {
  const now = input.now ?? new Date();
  const byTicker = new Map(input.research.reports.map((r) => [r.ticker, r]));
  const ranking = input.research.ranking;
  const rankOf = new Map((ranking?.entries ?? []).map((e) => [e.ticker, e]));
  const excluded: AiLabResult['excluded'] = [];
  const strong: StoredReport[] = [];
  const lower: StoredReport[] = [];
  const whyNot = new Map<string, string>();
  for (const ticker of input.shortlist) {
    const stored = byTicker.get(ticker);
    const reason = ineligibleReason(stored, now);
    if (!reason) strong.push(stored!);
    else if (ineligibleReason(stored, now, LOW_CONVICTION) === null) { lower.push(stored!); whyNot.set(ticker, reason); }
    else {
      const r = stored?.report;
      excluded.push(r
        ? { ticker, reason, view: { thesis: r.thesis, valuation: r.valuationView, expectedReturnPct: r.expectedReturn.basePct, risks: r.risks.slice(0, 3) } }
        : { ticker, reason });
    }
  }
  // Order by the model's ranking when it covers the company, otherwise by conviction; keep the best five.
  const byRank = (a: StoredReport, b: StoredReport) => {
    const ra = rankOf.get(a.ticker)?.rank ?? Infinity;
    const rb = rankOf.get(b.ticker)?.rank ?? Infinity;
    return ra !== rb ? ra - rb : effectiveConviction(b.report.conviction, b.verification) - effectiveConviction(a.report.conviction, a.verification);
  };
  // Lower-conviction names only come in while there are too few strong ones.
  const fill = strong.length < MIN_STRONG_PICKS ? [...lower].sort(byRank) : [];
  for (const left of fill.length ? [] : lower) {
    const r = left.report;
    excluded.push({ ticker: left.ticker, reason: whyNot.get(left.ticker) ?? '', view: { thesis: r.thesis, valuation: r.valuationView, expectedReturnPct: r.expectedReturn.basePct, risks: r.risks.slice(0, 3) } });
  }
  const lowTickers = new Set(fill.map((r) => r.ticker));
  const ordered = [...[...strong].sort(byRank), ...fill];
  for (const dropped of ordered.slice(MAX_PICKS)) excluded.push({ ticker: dropped.ticker, reason: `Ranked below the top ${MAX_PICKS} of your shortlist.` });
  const top = ordered.slice(0, MAX_PICKS);
  // Model weight when the ranking has one; otherwise a share of 100 proportional to conviction.
  const convictionTotal = top.reduce((s, r) => s + effectiveConviction(r.report.conviction, r.verification), 0) || 1;
  const weights = top.map((r) => {
    const w = rankOf.get(r.ticker)?.modelWeightPct;
    const base = w && w > 0 ? w : Math.round((effectiveConviction(r.report.conviction, r.verification) / convictionTotal) * 1000) / 10;
    return lowTickers.has(r.ticker) ? Math.round(base * LOW_TIER_WEIGHT * 10) / 10 : base;
  });
  const picks: AiLabPick[] = top.map((r, i) => ({
    ticker: r.ticker, name: input.names[r.ticker] ?? r.ticker, rank: i + 1,
    allocationPct: Math.min(35, weights[i]),
    conviction: rankOf.get(r.ticker)?.conviction ?? effectiveConviction(r.report.conviction, r.verification),
    expectedReturn: r.report.expectedReturn, thesis: r.report.thesis, bullCase: r.report.bullCase, bearCase: r.report.bearCase,
    bearReviewNote: r.report.bearReviewNote, catalysts: r.report.catalysts, risks: r.report.risks, evidence: r.report.evidence,
    note: rankOf.get(r.ticker)?.note ?? '', thesisState: r.report.holdingView.thesisState,
    lowConviction: lowTickers.has(r.ticker) || undefined,
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
