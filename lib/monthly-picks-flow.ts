// Pure decision logic for the Monthly Picks run state machine, kept free of D1 and
// Worker imports so `node --test` can exercise it (tests/monthly-picks-flow.test.mjs).
// Status flow: gathering -> in_progress -> completed | failed.

export const FACTS_MAX_AGE_DAYS = 7;
export const GATHER_TIMEOUT_MS = 6 * 60_000;
export const DISPATCH_DEDUPE_MS = 10 * 60_000;

export type FactsState = 'fresh' | 'stale' | 'missing' | 'failed';
export type FactsStatus = {
  ticker: string;
  state: FactsState;
  fetchedOn: string | null;
  ageDays: number | null;
  error: string | null;
  requestedAt: string | null;
  attemptedAt: string | null;
};

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** `fetchedOn` / `day` are PKT calendar days (YYYY-MM-DD). */
export function classifyFacts(
  ticker: string,
  fetchedOn: string | null,
  request: { requestedAt: string; attemptedAt: string | null; error: string | null } | null,
  day: string,
): FactsStatus {
  const error = request?.error ?? null;
  const base = { ticker, error, requestedAt: request?.requestedAt ?? null, attemptedAt: request?.attemptedAt ?? null };
  if (!fetchedOn) return { ...base, state: error ? 'failed' : 'missing', fetchedOn: null, ageDays: null };
  const ageDays = Math.max(0, dayNumber(day) - dayNumber(fetchedOn));
  return { ...base, state: ageDays <= FACTS_MAX_AGE_DAYS ? 'fresh' : 'stale', fetchedOn, ageDays };
}

/** A ticker needs a scrape before a run when it has no fresh facts. */
export const needsScrape = (status: FactsStatus) => status.state !== 'fresh';

/** True once a scrape attempt (success or failure) finished after the run began waiting. */
export function scrapeSettled(status: FactsStatus, startedAt: string): boolean {
  // Only non-fresh tickers are ever pending, so fresh here means a scrape just landed.
  if (status.state === 'fresh') return true;
  if (!status.attemptedAt || status.attemptedAt < startedAt) return false;
  return !status.requestedAt || status.attemptedAt >= status.requestedAt;
}

export type GatherStep = { action: 'proceed'; reason: 'settled' | 'timeout' } | { action: 'wait'; pending: string[] };

export function nextGatherStep(input: { startedAt: string; now: number; pending: FactsStatus[] }): GatherStep {
  const waiting = input.pending.filter((status) => !scrapeSettled(status, input.startedAt));
  if (!waiting.length) return { action: 'proceed', reason: 'settled' };
  if (input.now - Date.parse(input.startedAt) > GATHER_TIMEOUT_MS) return { action: 'proceed', reason: 'timeout' };
  return { action: 'wait', pending: waiting.map((status) => status.ticker) };
}

/** Human-readable reason a ticker has no usable facts. */
export function unavailableReason(status: FactsStatus): string {
  if (status.state === 'failed') return `PSX scrape failed: ${status.error}`;
  return 'No PSX company data yet — the scraper has not fetched this ticker.';
}

type ReusableRow = {
  status: string; workflowVersion: number; shortlist: string[]; dataAsOf?: string | null;
};
/** A saved run is reused only if it completed under the current workflow with matching inputs and same-day data. */
export function canReuseRun(row: ReusableRow, shortlist: string[], today: string, currentVersion: number): boolean {
  return row.status === 'completed' && row.workflowVersion >= currentVersion && row.dataAsOf === today &&
    JSON.stringify([...row.shortlist].sort()) === JSON.stringify([...shortlist].sort());
}
