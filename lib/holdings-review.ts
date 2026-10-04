// AI Lab holdings review. The public research says whether each company still deserves to be owned; this device-side
// step combines that with the user's own position (weight, gain, the 20% concentration limit). The position data
// never leaves the device. Advice only: nothing here places or schedules a trade.
import { CONCENTRATION_CAP_PCT } from './monthly-picks-allocation.ts';
import { reportUsable } from './ai-research/reuse.ts';
import { effectiveConviction } from './ai-research/verify.ts';
import type { PublicResearch } from './ai-research/types.ts';
import type { HoldingSuggestion } from './ai-lab-types.ts';

export type HeldPosition = {
  ticker: string;
  name: string;
  shares: number;
  /** Market value in PKR, or null when there is no usable price. */
  value: number | null;
  price: number | null;
  /** Remaining cost in PKR, or null when unknown. */
  cost: number | null;
};

export const SELL_CONVICTION = 30;
export const ADD_CONVICTION = 70;
export const TRIM_CONVICTION = 50;
/** An "add" suggestion needs room: the position must be comfortably under the concentration limit. */
export const ADD_MAX_WEIGHT_PCT = 15;
export const ADD_MIN_EXPECTED_PCT = 5;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function reviewHoldings(positions: HeldPosition[], research: PublicResearch, now = new Date()): HoldingSuggestion[] {
  const open = positions.filter((p) => p.shares > 0);
  const total = open.reduce((s, p) => s + (p.value ?? 0), 0);
  const byTicker = new Map(research.reports.map((r) => [r.ticker, r]));
  return open.map((p) => {
    const weightPct = p.value !== null && total > 0 ? round1((p.value / total) * 100) : null;
    const gainPct = p.value !== null && p.cost !== null && p.cost > 0 ? round1(((p.value - p.cost) / p.cost) * 100) : null;
    const base = { ticker: p.ticker, name: p.name, weightPct, gainPct, trimShares: null as number | null };
    const stored = byTicker.get(p.ticker);
    if (!stored || !reportUsable(stored, now)) {
      return {
        ...base, action: 'review' as const, conviction: null, thesisState: null, sources: [], researchedAt: stored?.researchedAt ?? null, carriedForward: false,
        reasons: [stored ? 'The research is out of date or its sources did not check out, so no call is made.' : 'No AI research for this company yet.'],
        watch: 'Prepare research for this company to get a suggestion.',
      };
    }
    const c = stored.report;
    const conviction = effectiveConviction(c.conviction, stored.verification);
    const view = c.holdingView;
    const sources = [
      ...view.redFlags.map((f) => ({ label: f.text, url: f.sourceUrl })),
      ...c.evidence.filter((e) => e.sourceUrl).slice(0, 3).map((e) => ({ label: e.claim, url: e.sourceUrl })),
    ];
    const common = { ...base, conviction, thesisState: view.thesisState, sources, researchedAt: stored.researchedAt, carriedForward: stored.carriedForward, watch: view.whatWouldMakeItASell };
    const overweight = weightPct !== null && weightPct > CONCENTRATION_CAP_PCT;

    // Sell needs verified evidence: the research job already removed red flags it could not check.
    if (view.redFlags.length > 0 && (view.thesisState === 'broken' || conviction < SELL_CONVICTION))
      return { ...common, action: 'sell' as const, reasons: [c.thesis, ...view.redFlags.map((f) => `Red flag: ${f.text}`)] };

    if (overweight && p.value !== null && p.price && p.price > 0) {
      const excess = p.value - (total * CONCENTRATION_CAP_PCT) / 100;
      return {
        ...common, action: 'trim' as const, trimShares: Math.min(p.shares, Math.ceil(excess / p.price)),
        reasons: [`This is ${weightPct}% of your portfolio, above the ${CONCENTRATION_CAP_PCT}% limit. Selling about ${Math.min(p.shares, Math.ceil(excess / p.price))} shares brings it back under.`, c.thesis],
      };
    }
    if (view.stretchedValuation && conviction < TRIM_CONVICTION)
      return { ...common, action: 'trim' as const, reasons: ['The price looks stretched against its own range and sector, and conviction is low.', c.valuationView] };

    if (conviction >= ADD_CONVICTION && view.thesisState === 'intact' && !view.stretchedValuation &&
        c.expectedReturn.basePct >= ADD_MIN_EXPECTED_PCT && (weightPct === null || weightPct < ADD_MAX_WEIGHT_PCT))
      return { ...common, action: 'add' as const, reasons: [c.thesis, `Expected 3-month return about ${c.expectedReturn.basePct}% (range ${c.expectedReturn.lowPct}% to ${c.expectedReturn.highPct}%).`] };

    const reasons = [c.thesis];
    if (view.thesisState === 'weakened') reasons.push('The case for owning it has weakened; watch the next result.');
    return { ...common, action: 'keep' as const, reasons };
  }).sort((a, b) => ORDER[a.action] - ORDER[b.action] || (b.weightPct ?? 0) - (a.weightPct ?? 0));
}

const ORDER = { sell: 0, trim: 1, review: 2, add: 3, keep: 4 } as const;
