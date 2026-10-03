// One Monthly Picks run, end to end, shared by the web hook and the phone screen. The only network traffic is for
// PUBLIC data about client-named tickers (`io.analysis`, `io.requestFacts`); ranking and sizing happen here from the
// decrypted holdings the caller hands in, and the caller stores the result in the encrypted portfolio.
import { classifyFacts, GATHER_TIMEOUT_MS, needsScrape } from './monthly-picks-flow.ts';
import { newProgress, withStep, type RunProgress } from './monthly-picks-progress.ts';
import { runLocalPicks, type StoredPicksRun } from './picks-local.ts';
import type { PublicAnalysis } from './public-analysis-types.ts';
import type { HoldingValue } from './monthly-picks-allocation.ts';

export type PicksRunIo = {
  analysis(tickers: string[]): Promise<PublicAnalysis & { dispatchEnabled: boolean }>;
  /** Asks for a fresh company-data scrape (tickers only). Resolves whether the caller should wait for it. */
  requestFacts(tickers: string[]): Promise<{ waiting: boolean }>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Poll interval while waiting (5 s, easing to 15 s). */
  pollMs(elapsedMs: number): number;
  onProgress(progress: RunProgress): void;
};

export type PicksRunInput = { month: string; amount: number; feePct: number; shortlist: string[]; holdings: HoldingValue[] };

export async function executePicksRun(io: PicksRunIo, input: PicksRunInput): Promise<{ run: StoredPicksRun; analysis: PublicAnalysis }> {
  const stamp = () => new Date(io.now()).toISOString();
  let state = newProgress(input.shortlist.length, stamp());
  const set = (next: RunProgress) => { state = next; io.onProgress(next); };
  set(state);
  set(withStep(state, 'gathering', stamp(), { message: 'Checking which company data is up to date.' }));
  let analysis = await io.analysis(input.shortlist);
  const stale = analysis.facts.filter((info) => needsScrape(classifyFacts(info.ticker, info.fetchedOn, null, analysis.dataAsOf))).map((info) => info.ticker);
  if (stale.length && analysis.dispatchEnabled) {
    const requested = await io.requestFacts(stale).catch(() => ({ waiting: false }));
    if (requested.waiting) {
      const began = io.now();
      for (;;) {
        set(withStep(state, 'gathering', stamp(), {
          pending: stale, completed: input.shortlist.length - stale.length, total: input.shortlist.length,
          message: `Waiting for PSX company data for ${stale.length} of ${input.shortlist.length} companies.`,
        }));
        await io.sleep(io.pollMs(io.now() - began));
        analysis = await io.analysis(input.shortlist);
        if (!analysis.facts.some((info) => stale.includes(info.ticker) && info.state !== 'fresh')) break;
        if (io.now() - began > GATHER_TIMEOUT_MS) {
          set(withStep(state, 'gathering', stamp(), { degraded: true, message: 'The company data fetch timed out; continuing with the evidence available.' }));
          break;
        }
      }
    }
  }
  set(withStep(state, 'metrics', stamp(), { pending: [], completed: input.shortlist.length, total: input.shortlist.length }));
  set(withStep(state, 'allocating', stamp()));
  const run = runLocalPicks({
    analysis, month: input.month, amount: input.amount, feePct: input.feePct, shortlist: input.shortlist,
    holdings: input.holdings, now: new Date(io.now()),
  });
  return { run, analysis };
}

/** Marks the stored result as saved (call after the encrypted save succeeded). */
export const savedProgress = (progress: RunProgress, now: string) => withStep(progress, 'saved', now);
