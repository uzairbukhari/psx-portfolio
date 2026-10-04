// Monthly spend ledger. `spentUsd` is what earlier calls (and earlier runs this month) really cost; `reserve` holds
// back the worst case of a call before it is made, so the cap cannot be crossed by a call that is already in flight.
export class CapReachedError extends Error {
  readonly capUsd: number;
  readonly spentUsd: number;
  constructor(capUsd: number, spentUsd: number) {
    super(`The monthly AI research cap of $${capUsd.toFixed(2)} would be exceeded (spent $${spentUsd.toFixed(2)}).`);
    this.name = 'CapReachedError';
    this.capUsd = capUsd;
    this.spentUsd = spentUsd;
  }
}

export class Ledger {
  private reservedUsd = 0;
  private runUsd = 0;
  /** Money held back for the final ranking so company research cannot starve it. */
  private holdUsd = 0;
  /** null = no cap: spend is recorded but never blocks a call. */
  readonly capUsd: number | null;
  private spentBeforeUsd: number;
  constructor(capUsd: number | null, spentBeforeUsd: number) {
    this.capUsd = capUsd;
    this.spentBeforeUsd = spentBeforeUsd;
  }

  setHold(usd: number) { this.holdUsd = Math.max(0, usd); }

  get spentUsd() { return this.spentBeforeUsd + this.runUsd; }
  get costThisRun() { return this.runUsd; }
  get remainingUsd() { return this.capUsd === null ? Infinity : Math.max(0, this.capUsd - this.spentUsd - this.reservedUsd); }

  /** Whether a call with this worst case still fits under the cap. */
  canAfford(worstCaseUsd: number, ignoreHold = false) {
    if (this.capUsd === null) return true;
    return this.spentUsd + this.reservedUsd + worstCaseUsd + (ignoreHold ? 0 : this.holdUsd) <= this.capUsd + 1e-9;
  }

  /** Holds the worst case; returns a settle function that swaps it for the measured cost (or releases it on failure). */
  reserve(worstCaseUsd: number, ignoreHold = false): (actualUsd: number | null) => void {
    if (!this.canAfford(worstCaseUsd, ignoreHold)) throw new CapReachedError(this.capUsd ?? 0, this.spentUsd + this.reservedUsd);
    this.reservedUsd += worstCaseUsd;
    let settled = false;
    return (actualUsd) => {
      if (settled) return;
      settled = true;
      this.reservedUsd -= worstCaseUsd;
      // A failed call may still have been billed; count the worst case when the provider's answer is unknown.
      this.runUsd += actualUsd ?? worstCaseUsd;
    };
  }
}

/** First day of the calendar month (UTC) containing `now`, as an ISO timestamp. */
export const monthStart = (now: Date): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
export const monthKey = (now: Date): string => now.toISOString().slice(0, 7);
