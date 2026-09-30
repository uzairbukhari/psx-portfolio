/**
 * Shared allocation constraints for Monthly Picks, applied to both AI and
 * quantitative results so they obey one rule set: no single pick above the cap,
 * allocations plus cash totalling 100%, and money that cannot be placed within
 * the cap left as cash.
 */
export const MAX_PICK_PCT = 35;

const round2 = (n: number) => Math.round(n * 100) / 100;

export type WeightInput = { ticker: string; weight: number };
export type Constrained = {
  allocations: { ticker: string; allocationPct: number }[];
  cashPct: number;
};

/**
 * Turns relative weights (plus an optional requested cash share) into percentages.
 * Weights and cash are first scaled to total 100, preserving their proportions; any
 * pick above `capPct` is held at the cap and its excess re-split pro rata across the
 * picks still below it; whatever cannot be placed under the cap becomes cash.
 * Weights that are not positive finite numbers are ignored.
 */
export function constrainAllocations(
  weights: WeightInput[],
  requestedCashPct: number | undefined,
  capPct: number = MAX_PICK_PCT,
): Constrained {
  const items = weights.filter((w) => Number.isFinite(w.weight) && w.weight > 0);
  if (!items.length) return { allocations: [], cashPct: 100 };
  const sum = items.reduce((a, w) => a + w.weight, 0);
  const cash =
    requestedCashPct !== undefined && Number.isFinite(requestedCashPct) && requestedCashPct >= 0
      ? requestedCashPct
      : Math.max(0, 100 - sum);
  const scale = 100 / (sum + cash);
  const scaled = items.map((w) => w.weight * scale);
  const budget = scaled.reduce((a, v) => a + v, 0);

  const capped = items.map(() => false);
  let pct = scaled;
  for (let iteration = 0; iteration <= items.length; iteration++) {
    const cappedTotal = capped.filter(Boolean).length * capPct;
    const activeTotal = scaled.reduce((a, v, i) => (capped[i] ? a : a + v), 0);
    const room = Math.max(0, budget - cappedTotal);
    pct = scaled.map((v, i) => (capped[i] ? capPct : activeTotal > 0 ? (v / activeTotal) * room : 0));
    const over = pct.findIndex((v, i) => !capped[i] && v > capPct + 1e-9);
    if (over === -1) break;
    capped[over] = true;
  }
  if (pct.some((v, i) => !capped[i] && v > capPct + 1e-9)) pct = pct.map((v) => Math.min(v, capPct));

  const rounded = pct.map(round2);
  let cashPct = round2(100 - rounded.reduce((a, v) => a + v, 0));
  if (cashPct < 0) {
    // Rounding pushed the picks over 100: trim the largest pick (stays under the cap).
    const largest = rounded.indexOf(Math.max(...rounded));
    rounded[largest] = round2(rounded[largest] + cashPct);
    cashPct = 0;
  }
  return {
    allocations: items.map((w, i) => ({ ticker: w.ticker, allocationPct: rounded[i] })),
    cashPct,
  };
}
