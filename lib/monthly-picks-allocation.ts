// Portfolio-aware sizing for Monthly Picks. The AI chooses picks and relative weights; this
// code only enforces the hard limits on them, in integer paisa so the budget always adds up:
//   - at most CONTRIBUTION_CAP_PCT of the fresh money in any one pick, and
//   - no holding above CONCENTRATION_CAP_PCT of (existing portfolio value + fresh money) after buying, once the stocks
//     held are worth at least CONCENTRATION_MIN_MULTIPLE times the fresh money.
// Constrained money is redistributed pro rata among picks that still have room; what cannot
// be placed stays cash. Nothing is ever sold. If a held position has no usable valuation the
// concentration limit cannot be evaluated, so the result is flagged incomplete rather than
// treating that position as worth zero.
export const CONTRIBUTION_CAP_PCT = 35;
export const CONCENTRATION_CAP_PCT = 20;
/** The per-holding limit only applies once the stocks held are worth this many times the month's money; before that it would leave most of a small portfolio's contribution as cash. */
export const CONCENTRATION_MIN_MULTIPLE = 5;

export type HoldingValue = { ticker: string; valuePkr: number | null };
export type WeightedPick = { ticker: string; allocationPct: number };
export type ConstraintReason = 'contribution_cap' | 'concentration_cap' | 'overweight';
export type SizedPick = {
  ticker: string;
  requestedPct: number;
  allocationPaisa: number;
  allocationPct: number;
  constrainedBy: ConstraintReason | null;
};
export type SizedAllocation = {
  picks: SizedPick[];
  cashPaisa: number;
  /** True when a held position had no valuation, so the concentration limit was not applied. */
  incomplete: boolean;
  missingValuations: string[];
};

const paisa = (pkr: number) => Math.round(pkr * 100);

export function sizeAllocation(
  picks: WeightedPick[],
  holdings: HoldingValue[],
  amountPkr: number,
): SizedAllocation {
  const total = paisa(amountPkr);
  if (!Number.isFinite(amountPkr) || total <= 0) throw new Error('Investment amount must be positive.');
  const held = new Map(holdings.map((h) => [h.ticker, h.valuePkr]));
  const missingValuations = holdings.filter((h) => h.valuePkr === null).map((h) => h.ticker);
  const incomplete = missingValuations.length > 0;
  const portfolioPaisa = holdings.reduce((sum, h) => sum + (h.valuePkr === null ? 0 : paisa(h.valuePkr)), 0);
  const concentrationApplies = incomplete || portfolioPaisa >= total * CONCENTRATION_MIN_MULTIPLE;
  const concentrationLimit = concentrationApplies ? Math.floor(((portfolioPaisa + total) * CONCENTRATION_CAP_PCT) / 100) : Infinity;
  const contributionLimit = Math.floor((total * CONTRIBUTION_CAP_PCT) / 100);

  const items = picks
    .filter((p) => Number.isFinite(p.allocationPct) && p.allocationPct > 0)
    .map((p) => {
      const heldPaisa = incomplete ? 0 : paisa(held.get(p.ticker) ?? 0);
      const room = incomplete ? Infinity : Math.max(0, concentrationLimit - heldPaisa);
      const cap = Math.min(contributionLimit, room);
      const reason: ConstraintReason = room < contributionLimit ? (room === 0 && heldPaisa > 0 ? 'overweight' : 'concentration_cap') : 'contribution_cap';
      return { ticker: p.ticker, weight: p.allocationPct, cap, reason, got: 0, constrained: false };
    });

  // Water-fill: share the money pro rata to weight, clamp to each cap, repeat with the excess.
  let remaining = Math.min(total, Math.floor((total * items.reduce((s, i) => s + i.weight, 0)) / 100));
  let active = items.filter((i) => i.cap > 0);
  items.filter((i) => i.cap === 0).forEach((i) => (i.constrained = true));
  while (remaining > 0 && active.length) {
    const weightSum = active.reduce((s, i) => s + i.weight, 0);
    let spent = 0;
    const next: typeof active = [];
    for (const item of active) {
      const share = Math.floor((remaining * item.weight) / weightSum);
      const grant = Math.min(share, item.cap - item.got);
      item.got += grant;
      spent += grant;
      if (item.got >= item.cap) item.constrained = true;
      else next.push(item);
    }
    remaining -= spent;
    if (spent === 0) break; // only rounding dust left; it stays cash
    active = next;
  }
  // Rounding dust goes to the first picks that still have room, one paisa at a time.
  for (const item of items) {
    if (remaining <= 0) break;
    const add = Math.min(remaining, item.cap - item.got);
    if (add > 0) { item.got += add; remaining -= add; }
  }

  const sized = items.map((i) => ({
    ticker: i.ticker,
    requestedPct: i.weight,
    allocationPaisa: i.got,
    allocationPct: Math.round((i.got / total) * 10_000) / 100,
    constrainedBy: i.constrained ? i.reason : null,
  }));
  const used = sized.reduce((s, i) => s + i.allocationPaisa, 0);
  return { picks: sized.filter((p) => p.allocationPaisa > 0 || p.constrainedBy), cashPaisa: total - used, incomplete, missingValuations };
}

export type MonthlyPicksSizing = {
  /** Hash of the holdings the limits were applied against; a different fingerprint means a recalculation. */
  holdingsFingerprint: string;
  computedAt: string;
  /** Held tickers and their combined value when the limits were applied, to tell a stale run from a current one. */
  heldTickers?: string[];
  portfolioPkr?: number;
  incomplete: boolean;
  missingValuations: string[];
  cashPkr: number;
  picks: { ticker: string; requestedPct: number; allocationPkr: number; constrainedBy: ConstraintReason | null }[];
};

export function holdingsFingerprint(holdings: HoldingValue[]): string {
  const text = [...holdings].sort((a, b) => a.ticker.localeCompare(b.ticker)).map((h) => `${h.ticker}:${h.valuePkr ?? 'na'}`).join('|');
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${holdings.length}-${hash.toString(16)}`;
}

type SizableResult = {
  picks: { ticker: string; allocationPct: number }[];
  unallocatedPct: number;
  sizing?: MonthlyPicksSizing;
};

/**
 * Applies the contribution and concentration limits to an AI or quant result and records exactly
 * what was done. Picks that end with no money are removed (their coverage entry stays).
 */
export function applySizing<T extends SizableResult>(result: T, holdings: HoldingValue[], amountPkr: number, now = new Date()): T {
  const sized = sizeAllocation(result.picks, holdings, amountPkr);
  const total = paisa(amountPkr);
  const byTicker = new Map(sized.picks.map((p) => [p.ticker, p]));
  const picks = result.picks.flatMap((pick) => {
    const s = byTicker.get(pick.ticker);
    return s && s.allocationPaisa > 0 ? [{ ...pick, allocationPct: s.allocationPct }] : [];
  });
  return {
    ...result,
    picks,
    unallocatedPct: Math.round((sized.cashPaisa / total) * 10_000) / 100,
    sizing: {
      holdingsFingerprint: holdingsFingerprint(holdings),
      computedAt: now.toISOString(),
      heldTickers: holdings.filter((h) => (h.valuePkr ?? 1) > 0).map((h) => h.ticker).sort(),
      portfolioPkr: Math.round(holdings.reduce((sum, h) => sum + (h.valuePkr ?? 0), 0)),
      incomplete: sized.incomplete,
      missingValuations: sized.missingValuations,
      cashPkr: sized.cashPaisa / 100,
      picks: sized.picks.map((p) => ({ ticker: p.ticker, requestedPct: p.requestedPct, allocationPkr: p.allocationPaisa / 100, constrainedBy: p.constrainedBy })),
    },
  };
}

/**
 * True when the holdings a saved result was sized against have clearly moved on: a different set of held companies, or
 * a portfolio worth over a tenth more or less. Price moves of a few percent are not worth telling anyone about.
 */
export function sizingIsStale(sizing: MonthlyPicksSizing | undefined, holdings: HoldingValue[]): boolean {
  if (!sizing?.heldTickers || sizing.portfolioPkr === undefined) return false;
  const now = holdings.filter((h) => (h.valuePkr ?? 1) > 0).map((h) => h.ticker).sort();
  if (now.length !== sizing.heldTickers.length || now.some((t, i) => t !== sizing.heldTickers![i])) return true;
  const value = holdings.reduce((sum, h) => sum + (h.valuePkr ?? 0), 0);
  const before = sizing.portfolioPkr;
  return before > 0 ? Math.abs(value - before) / before > 0.1 : value > 0;
}

const REASON_TEXT: Record<ConstraintReason, string> = {
  contribution_cap: `capped at ${CONTRIBUTION_CAP_PCT}% of this month's money`,
  concentration_cap: `limited so it stays within ${CONCENTRATION_CAP_PCT}% of your portfolio after buying`,
  overweight: `already above ${CONCENTRATION_CAP_PCT}% of your portfolio, so nothing new is added (nothing is sold)`,
};

/** Plain-language lines explaining every limit the app applied to a saved result. */
export function explainSizing(sizing: MonthlyPicksSizing | undefined): string[] {
  if (!sizing) return [];
  const lines = sizing.picks.filter((p) => p.constrainedBy).map((p) => `${p.ticker}: ${REASON_TEXT[p.constrainedBy!]}.`);
  if (sizing.incomplete)
    lines.push(`Portfolio limits could not be fully applied: no price for ${sizing.missingValuations.join(', ')}. Add a price and run again.`);
  return lines;
}
