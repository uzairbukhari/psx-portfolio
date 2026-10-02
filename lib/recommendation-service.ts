// Monthly Picks run engine, shared by the web Worker (start / read) and the cron Worker (advance).
// It takes its D1 handle and settings explicitly, so it runs in either Worker and under test.
//
// Execution model: a run is a row in `monthly_recommendations`. `advanceRun` claims the row with a
// lease token (compare-and-set), performs ONE step, and releases it. Every state-changing write
// carries the lease token, so a worker whose lease expired (crash, timeout) can never finish a run
// a newer worker now owns. The cron processor (`processDueRuns`) advances due runs once a minute,
// so a run reaches a terminal state without any client polling.
// Status flow: gathering -> in_progress -> completed | failed | needs_attention.
import { blankPortfolio, holdings, today, type Portfolio } from './portfolio.ts';
import { readFacts, readFactsStatus } from './company-facts-store.ts';
import { computeMetrics, overlayQuote, quantScore, type CompanyMetrics, type CompanyScore } from './company-facts.ts';
import { readQuoteRows } from './quote-cache.ts';
import { dispatchEnabled, requestFacts, type DispatchConfig } from './github-dispatch.ts';
import {
  canReuseRun, needsScrape, nextGatherStep, unavailableReason, FACTS_MAX_AGE_DAYS,
  aiCapCheck, parseAiCap, pktMonthStartIso,
} from './monthly-picks-flow.ts';
import { takeRateLimit, waitText } from './rate-limit.ts';
import {
  WORKFLOW_VERSION, POLICY_VERSION, MIN_ADVANCE_VERSION, MODEL, BUDGET_USD, PICK_RESERVE,
  pickRequest, sanitizePicks, quantResult, outputText, usage,
  type ProviderResponse, type SnapshotV8,
} from './monthly-picks-ai.ts';
import type { MonthlyPicksResearch } from './monthly-picks.ts';
import { applySizing, holdingsFingerprint, CONTRIBUTION_CAP_PCT, CONCENTRATION_CAP_PCT, type HoldingValue } from './monthly-picks-allocation.ts';
import { newProgress, parseProgress, progressPercent, withStep, isIndeterminate, type RunProgress } from './monthly-picks-progress.ts';
import { UserError } from './user-error.ts';
import { pakistanMarketState } from './psx-market.ts';

export type RunEnv = {
  db: D1Database;
  openaiKey?: string;
  aiCapUsd?: string;
  dispatch: DispatchConfig;
  /** Injected for tests. */
  fetch?: typeof fetch;
  now?: () => Date;
};
type Lease = RunEnv & { token: string };

export type Row = {
  id: string; user_id: string; month: string; amount: number; fee_pct: number; shortlist: string;
  status: string; provider_response_id: string | null; result: string | null; sources: string | null;
  error: string | null; model: string; estimated_cost_usd: number | null; workflow_version: number;
  snapshot: string | null; gather_started_at: string | null; pending_tickers: string | null;
  next_attempt_at: string | null; lease_token: string | null; lease_expires_at: string | null;
  deadline_at: string | null; progress: string | null; idempotency_key: string | null;
  created_at: string; updated_at: string;
};
type Attempt = {
  id: string; recommendation_id: string; phase: string; cycle: number; batch_key: string; state: string;
  provider_response_id: string | null; request: string; response: string | null;
  reserved_usd: number; cost_usd: number | null; error: string | null; created_at: string;
};

export const ACTIVE = ['queued', 'gathering', 'in_progress'];
const SUBMIT_STUCK_MS = 120_000;
export const RUN_TIMEOUT_MS = 5 * 60_000;
/** A lease not renewed for this long is considered dead and may be taken over. */
export const LEASE_MS = 90_000;
/** Hard ceiling for any run: past this the watchdog fails it with an explicit reason. */
export const MAX_RUN_AGE_MS = 30 * 60_000;
/** Seconds-scale pause between steps of one run (the cron tick is the floor). */
const RETRY_BACKOFF_MS = 60_000;
export const FACTS_DISPATCH_LIMIT = { windowMs: 86_400_000, max: 10 };

const clock = (env: RunEnv) => (env.now ?? (() => new Date()))();
const stamp = (env: RunEnv) => clock(env).toISOString();

const parseList = (value: string | null): string[] => {
  try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};
export const readRow = (env: RunEnv, id: string, owner: string) =>
  env.db.prepare('SELECT * FROM monthly_recommendations WHERE id=? AND user_id=?').bind(id, owner).first<Row>();
async function attempts(env: RunEnv, id: string) {
  return (await env.db.prepare('SELECT * FROM recommendation_attempts WHERE recommendation_id=? ORDER BY cycle,created_at,id').bind(id).all<Attempt>()).results;
}

// ---------------------------------------------------------------- views

function publicRow(row: Row) {
  return {
    id: row.id, month: row.month, amount: row.amount, feePct: row.fee_pct,
    shortlist: parseList(row.shortlist), status: row.status,
    result: row.result ? (JSON.parse(row.result) as MonthlyPicksResearch) : null,
    sources: row.sources ? JSON.parse(row.sources) : [], error: row.error, model: row.model,
    workflowVersion: row.workflow_version, estimatedCostUsd: row.estimated_cost_usd,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export function view(row: Row, committedUsd = 0) {
  const result = row.result ? (JSON.parse(row.result) as MonthlyPicksResearch) : null;
  const active = ACTIVE.includes(row.status);
  const progress = parseProgress(row.progress);
  return {
    ...publicRow(row),
    phase: row.status === 'gathering' ? 'gathering' : active ? 'ranking' : undefined,
    // `startedAt`/`pending` keep the shape older clients read; `steps` is the persisted detail.
    progress: active
      ? {
        phase: row.status === 'gathering' ? 'gathering' : 'ranking',
        pending: parseList(row.pending_tickers), startedAt: row.gather_started_at ?? row.created_at,
        ...(progress ? { ...progress, percent: progressPercent(progress), indeterminate: isIndeterminate(progress) } : {}),
      }
      : progress ? { ...progress, percent: progressPercent(progress), indeterminate: false } : undefined,
    budgetCommittedUsd: committedUsd,
    method: result?.method,
    dataAsOf: result?.dataAsOf,
  };
}
export async function viewOne(env: RunEnv, row: Row) {
  const list = row.workflow_version >= MIN_ADVANCE_VERSION ? await attempts(env, row.id) : [];
  return view(row, list.reduce((sum, attempt) => sum + (attempt.cost_usd ?? attempt.reserved_usd), 0));
}
export async function listRuns(env: RunEnv, owner: string) {
  const rows = (await env.db.prepare('SELECT * FROM monthly_recommendations WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(owner).all<Row>()).results;
  const costs = new Map((await env.db.prepare(`SELECT a.recommendation_id AS id,
      SUM(CASE WHEN a.cost_usd IS NULL THEN a.reserved_usd ELSE a.cost_usd END) AS cost
    FROM recommendation_attempts a JOIN monthly_recommendations r ON r.id=a.recommendation_id
    WHERE r.user_id=? GROUP BY a.recommendation_id`).bind(owner).all<{ id: string; cost: number }>()).results.map((r) => [r.id, r.cost]));
  return rows.map((row) => view(row, costs.get(row.id) ?? 0));
}

// ---------------------------------------------------------------- portfolio / snapshot

export async function readPortfolio(env: RunEnv, owner: string): Promise<Portfolio> {
  const saved = await env.db.prepare('SELECT payload FROM portfolios WHERE user_id=?').bind(owner).first<{ payload: string }>();
  return saved ? JSON.parse(saved.payload) : blankPortfolio();
}
/** Existing positions with a ledger-derived quantity, valued at their saved quote (null = no usable valuation). */
async function heldValues(env: RunEnv, owner: string): Promise<HoldingValue[]> {
  const portfolio = await readPortfolio(env, owner);
  return holdings(portfolio).filter((h) => h.shares > 0).map((h) => ({ ticker: h.ticker, valuePkr: h.value }));
}

async function buildSnapshot(env: RunEnv, row: Pick<Row, 'month' | 'amount' | 'created_at' | 'user_id'>, shortlist: string[]): Promise<SnapshotV8> {
  const owner = row.user_id;
  const dataAsOf = today();
  const entries = await readFacts(env.db, shortlist);
  const quotes = new Map((await readQuoteRows(env.db).catch(() => [])).map((quote) => [quote.ticker, quote]));
  const metrics: CompanyMetrics[] = entries.map(({ status, facts }) => {
    if (!facts) return computeMetrics({ ticker: status.ticker, unavailable: unavailableReason(status) }, dataAsOf);
    // Facts older than the freshness limit stay visible in coverage but can never support a new pick.
    if (status.state === 'stale') return computeMetrics({ ticker: status.ticker, unavailable: `Company data is ${status.ageDays} days old (limit ${FACTS_MAX_AGE_DAYS}); the latest scrape failed or is pending.` }, dataAsOf);
    const quote = quotes.get(status.ticker);
    return computeMetrics(
      overlayQuote(facts, quote && { price: quote.price, quoteDate: quote.quote_date, fetchedAt: quote.fetched_at }), dataAsOf,
    );
  });
  const scores: CompanyScore[] = quantScore(metrics);
  const companies = entries.map(({ status, facts }, index) => {
    const quote = quotes.get(status.ticker);
    const fresh = facts && overlayQuote(facts, quote && { price: quote.price, quoteDate: quote.quote_date, fetchedAt: quote.fetched_at });
    return {
      ticker: status.ticker,
      name: fresh ? fresh.name : status.ticker,
      sector: fresh ? fresh.sector : 'Unknown',
      source: fresh ? fresh.source : null,
      price: fresh ? fresh.price : null,
      priceDate: fresh ? fresh.priceDate : null,
      metrics: metrics[index],
    };
  });
  return {
    generatedOn: row.created_at.slice(0, 10), contributionMonth: row.month, freshMoneyPkr: row.amount,
    shortlist: [...shortlist], dataAsOf, companies, scores,
    inputs: {
      holdings: await heldValues(env, owner),
      index: await indexContext(env),
      policy: {
        workflow: WORKFLOW_VERSION, policy: POLICY_VERSION, model: MODEL,
        contributionCapPct: CONTRIBUTION_CAP_PCT, concentrationCapPct: CONCENTRATION_CAP_PCT, factsMaxAgeDays: FACTS_MAX_AGE_DAYS,
      },
    },
  };
}

/** KSE-100 as last stored by the market scraper, frozen into the run for context. */
async function indexContext(env: RunEnv) {
  try {
    const saved = await env.db.prepare("SELECT payload FROM market_summary_refreshes WHERE id='latest'").first<{ payload: string }>();
    const index = saved ? (JSON.parse(saved.payload) as { index?: { close?: number; asOf?: string } }).index : undefined;
    return index && Number.isFinite(index.close) && index.asOf ? { code: 'KSE100', close: Number(index.close), asOf: index.asOf } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------- guarded writes

/** Every state change is conditional on still holding the lease. Returns whether it applied. */
async function guarded(env: Lease, row: Row, sql: string, ...params: unknown[]): Promise<boolean> {
  const result = await env.db.prepare(`${sql} AND lease_token=?`).bind(...params, row.id, row.user_id, env.token).run();
  return result.meta.changes > 0;
}
// `sql` fragments below end in "WHERE id=? AND user_id=?" and `guarded` appends the lease check.
async function setState(env: Lease, row: Row, status: string, error: string | null = null, progress?: RunProgress) {
  await guarded(env, row,
    'UPDATE monthly_recommendations SET status=?,error=?,progress=COALESCE(?,progress),next_attempt_at=NULL,updated_at=? WHERE id=? AND user_id=?',
    status, error, progress ? JSON.stringify(progress) : null, stamp(env));
}
async function setProgress(env: Lease, row: Row, progress: RunProgress) {
  await guarded(env, row, 'UPDATE monthly_recommendations SET progress=?,updated_at=? WHERE id=? AND user_id=?', JSON.stringify(progress), stamp(env));
}
const progressOf = (row: Row): RunProgress => parseProgress(row.progress) ?? newProgress(parseList(row.shortlist).length, row.created_at);

async function finish(env: Lease, row: Row, unsized: MonthlyPicksResearch) {
  const at = stamp(env);
  // Code, not the model, enforces the 35% contribution and 20% concentration limits.
  const result = applySizing(unsized, await heldValues(env, row.user_id), row.amount, clock(env));
  const done = withStep(progressOf(row), 'saved', at, {
    degraded: result.method === 'quant' || progressOf(row).degraded, pending: [],
    message: result.fallbackReason ?? progressOf(row).message,
  });
  await guarded(env, row,
    "UPDATE monthly_recommendations SET status='completed',result=?,sources=?,error=NULL,progress=?,next_attempt_at=NULL,updated_at=? WHERE id=? AND user_id=?",
    JSON.stringify(result), JSON.stringify([]), JSON.stringify(done), at);
}

// ---------------------------------------------------------------- AI attempt bookkeeping

/**
 * Reserves AI spend atomically: the per-run budget AND the account's monthly cap are both checked
 * inside the one INSERT, so two concurrent requests cannot each pass a separate pre-check.
 */
async function createAttempt(env: Lease, row: Row, request: unknown, reserve: number) {
  const id = `${row.id}:0:pick:final`;
  const cap = parseAiCap(env.aiCapUsd);
  await env.db.prepare(`INSERT OR IGNORE INTO recommendation_attempts
    (id,recommendation_id,phase,cycle,batch_key,state,request,reserved_usd,created_at)
    SELECT ?,?,?,?,?,'pending',?,?,? WHERE
    COALESCE((SELECT SUM(CASE WHEN cost_usd IS NULL THEN reserved_usd ELSE cost_usd END)
      FROM recommendation_attempts WHERE recommendation_id=?),0)+?<=?
    AND COALESCE((SELECT SUM(cost_usd) FROM ai_usage WHERE user_id=? AND created_at>=?),0)
      +COALESCE((SELECT SUM(a.reserved_usd) FROM recommendation_attempts a JOIN monthly_recommendations r ON r.id=a.recommendation_id
        WHERE r.user_id=? AND a.cost_usd IS NULL AND a.state IN ('pending','submitting','in_progress')),0)+?<=?`)
    .bind(id, row.id, 'pick', 0, 'final', JSON.stringify(request), reserve, stamp(env), row.id, reserve, BUDGET_USD,
      row.user_id, pktMonthStartIso(clock(env)), row.user_id, reserve, cap).run();
  return env.db.prepare('SELECT * FROM recommendation_attempts WHERE id=?').bind(id).first<Attempt>();
}
async function submit(env: Lease, row: Row, attempt: Attempt) {
  const claimed = await env.db.prepare("UPDATE recommendation_attempts SET state='submitting' WHERE id=? AND state='pending'").bind(attempt.id).run();
  if (!claimed.meta.changes) return;
  try {
    const response = await (env.fetch ?? fetch)('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${env.openaiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000), body: attempt.request,
    });
    const result = await response.json() as ProviderResponse;
    if (!response.ok || !result.id) throw Error(result.error?.message ?? `OpenAI request failed (${response.status}).`);
    await env.db.batch([
      env.db.prepare("UPDATE recommendation_attempts SET state='in_progress',provider_response_id=? WHERE id=?").bind(result.id, attempt.id),
      env.db.prepare("UPDATE monthly_recommendations SET status='in_progress',provider_response_id=?,updated_at=? WHERE id=? AND user_id=?")
        .bind(result.id, stamp(env), row.id, row.user_id),
    ]);
  } catch (error) {
    // The request may have reached the provider: keep the reservation, never resubmit.
    const message = `Submission could not be confirmed. ${error instanceof Error ? error.message : ''}`.slice(0, 1000);
    await env.db.prepare("UPDATE recommendation_attempts SET state='uncertain',error=? WHERE id=?").bind(message, attempt.id).run();
    await recordEstimatedCost(env, row, attempt);
  }
}
/**
 * A call that may have reached OpenAI but whose usage was never read back (submission
 * unconfirmed, stuck, or timed out) is charged at its full reserve, so it still counts
 * against the user's monthly cap. Idempotent: never overwrites a measured cost.
 */
async function recordEstimatedCost(env: RunEnv, row: Row, attempt: Attempt) {
  await env.db.batch([
    env.db.prepare('UPDATE recommendation_attempts SET cost_usd=reserved_usd WHERE id=? AND cost_usd IS NULL').bind(attempt.id),
    env.db.prepare('INSERT OR IGNORE INTO ai_usage (id,user_id,source,model,input_tokens,output_tokens,cached_tokens,cost_usd,created_at) VALUES (?,?,?,?,0,0,0,?,?)')
      .bind(`monthly:${attempt.id}`, row.user_id, 'monthly_picks_estimate', MODEL, attempt.reserved_usd, stamp(env)),
    env.db.prepare('UPDATE monthly_recommendations SET estimated_cost_usd=(SELECT SUM(cost_usd) FROM recommendation_attempts WHERE recommendation_id=?),updated_at=? WHERE id=? AND user_id=?')
      .bind(row.id, stamp(env), row.id, row.user_id),
  ]);
}
/** AI spend this PKT month: measured or estimated usage plus reserves of calls still in flight. */
async function monthlyAiSpend(env: RunEnv, owner: string) {
  const used = await env.db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS usd FROM ai_usage WHERE user_id=? AND created_at>=?')
    .bind(owner, pktMonthStartIso(clock(env))).first<{ usd: number }>();
  const reserved = await env.db.prepare(`SELECT COALESCE(SUM(a.reserved_usd),0) AS usd FROM recommendation_attempts a
    JOIN monthly_recommendations r ON r.id=a.recommendation_id
    WHERE r.user_id=? AND a.cost_usd IS NULL AND a.state IN ('pending','submitting','in_progress')`)
    .bind(owner).first<{ usd: number }>();
  return (used?.usd ?? 0) + (reserved?.usd ?? 0);
}
async function archive(env: RunEnv, row: Row, attempt: Attempt, response: ProviderResponse) {
  const measured = usage(response);
  const state = response.status === 'completed' ? 'completed' : 'failed';
  await env.db.batch([
    env.db.prepare('UPDATE recommendation_attempts SET state=?,response=?,cost_usd=? WHERE id=? AND cost_usd IS NULL')
      .bind(state, JSON.stringify(response), measured.cost, attempt.id),
    env.db.prepare('INSERT OR IGNORE INTO ai_usage (id,user_id,source,model,input_tokens,output_tokens,cached_tokens,cost_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(`monthly:${attempt.id}`, row.user_id, 'monthly_picks', MODEL, measured.input, measured.output, measured.cached, measured.cost, stamp(env)),
    env.db.prepare('UPDATE monthly_recommendations SET estimated_cost_usd=(SELECT SUM(cost_usd) FROM recommendation_attempts WHERE recommendation_id=?),updated_at=? WHERE id=? AND user_id=?')
      .bind(row.id, stamp(env), row.id, row.user_id),
  ]);
}
async function retrieve(env: Lease, row: Row, attempt: Attempt): Promise<'pending' | 'completed' | 'failed'> {
  if (!attempt.provider_response_id) return 'failed';
  const response = await (env.fetch ?? fetch)(`https://api.openai.com/v1/responses/${encodeURIComponent(attempt.provider_response_id)}`, {
    headers: { Authorization: `Bearer ${env.openaiKey}` }, signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) return 'pending';
  const result = await response.json() as ProviderResponse;
  if (ACTIVE.includes(result.status ?? '')) return 'pending';
  await archive(env, row, attempt, result);
  return result.status === 'completed' ? 'completed' : 'failed';
}

// ---------------------------------------------------------------- run steps

/** Turns a run with a stored snapshot into a ranking: AI call when possible, quant result otherwise. */
async function beginRanking(env: Lease, row: Row, snapshot: SnapshotV8) {
  const usable = snapshot.companies.filter((company) => !company.metrics.unavailable);
  if (!usable.length) {
    const reasons = snapshot.companies.slice(0, 3).map((company) => `${company.ticker}: ${company.metrics.unavailable}`).join(' ');
    await setState(env, row, 'failed', `No shortlisted company has usable PSX data yet. ${reasons}`.slice(0, 600));
    return;
  }
  if (!env.openaiKey) { await finish(env, row, quantResult(snapshot, 'AI ranking is not configured, so this run used the quantitative ranking.')); return; }
  const cap = aiCapCheck(await monthlyAiSpend(env, row.user_id), PICK_RESERVE, parseAiCap(env.aiCapUsd));
  if (!cap.allowed) { await finish(env, row, quantResult(snapshot, cap.message)); return; }
  const attempt = await createAttempt(env, row, pickRequest(snapshot), PICK_RESERVE);
  // Budget can't cover the AI call: the deterministic result is still a complete answer.
  if (!attempt) { await finish(env, row, quantResult(snapshot, 'The AI budget for this run could not be reserved, so it used the quantitative ranking.')); return; }
  await setProgress(env, row, withStep(progressOf(row), 'ai', stamp(env), { message: 'Waiting for the AI ranking.' }));
  await submit(env, row, attempt);
}

/** Gathering: wait for the on-demand scrape, then snapshot the facts and start ranking. */
async function advanceGathering(env: Lease, row: Row) {
  const pending = parseList(row.pending_tickers);
  const shortlist = parseList(row.shortlist);
  let degraded = false;
  if (pending.length) {
    const step = nextGatherStep({
      startedAt: row.gather_started_at ?? row.created_at, now: clock(env).getTime(), pending: await readFactsStatus(env.db, pending),
    });
    if (step.action === 'wait') {
      const progress = withStep(progressOf(row), 'gathering', stamp(env), {
        pending: step.pending, completed: shortlist.length - step.pending.length, total: shortlist.length,
        message: `Waiting for PSX company data for ${step.pending.length} of ${shortlist.length} companies.`,
      });
      await guarded(env, row, "UPDATE monthly_recommendations SET pending_tickers=?,progress=?,updated_at=? WHERE id=? AND user_id=? AND status='gathering'",
        JSON.stringify(step.pending), JSON.stringify(progress), stamp(env));
      return;
    }
    degraded = step.reason === 'timeout';
  }
  await setProgress(env, row, withStep(progressOf(row), 'metrics', stamp(env), {
    pending: [], completed: shortlist.length, total: shortlist.length, degraded,
    message: degraded ? 'The company data fetch timed out; continuing with the evidence available.' : null,
  }));
  const snapshot = await buildSnapshot(env, row, shortlist);
  // Exactly one worker wins this transition; a stale lease holder changes nothing.
  const claimed = await guarded(env, row,
    "UPDATE monthly_recommendations SET status='in_progress',snapshot=?,pending_tickers=NULL,deadline_at=?,updated_at=? WHERE id=? AND user_id=? AND status='gathering'",
    JSON.stringify(snapshot), new Date(clock(env).getTime() + RUN_TIMEOUT_MS).toISOString(), stamp(env));
  if (!claimed) return;
  await beginRanking(env, { ...row, status: 'in_progress', snapshot: JSON.stringify(snapshot), progress: JSON.stringify(withStep(progressOf(row), 'metrics', stamp(env), { degraded })) }, snapshot);
}

async function advanceRanking(env: Lease, row: Row) {
  const snapshot = JSON.parse(row.snapshot ?? 'null') as SnapshotV8 | null;
  if (!snapshot) { await setState(env, row, 'failed', 'This run has no saved data snapshot.'); return; }
  const attempt = (await attempts(env, row.id)).find((a) => a.phase === 'pick');
  if (!attempt) { await beginRanking(env, row, snapshot); return; }
  if (!env.openaiKey) { await finish(env, row, quantResult(snapshot, 'AI ranking is not configured, so this run used the quantitative ranking.')); return; }

  if (attempt.state === 'uncertain' || attempt.state === 'failed') {
    await finish(env, row, quantResult(snapshot, attempt.state === 'uncertain'
      ? 'The AI request could not be confirmed (and is not retried, to avoid a second charge), so this run used the quantitative ranking.'
      : 'The AI request failed, so this run used the quantitative ranking.'));
    return;
  }
  if (attempt.state === 'submitting') {
    if (clock(env).getTime() - Date.parse(attempt.created_at) > SUBMIT_STUCK_MS) {
      await recordEstimatedCost(env, row, attempt);
      await finish(env, row, quantResult(snapshot, 'The AI request did not start in time, so this run used the quantitative ranking.'));
    }
    return;
  }
  if (attempt.state === 'pending') { await submit(env, row, attempt); return; }
  if (attempt.state === 'in_progress') {
    const outcome = await retrieve(env, row, attempt);
    if (outcome === 'pending') {
      if (clock(env).getTime() - Date.parse(attempt.created_at) > RUN_TIMEOUT_MS) {
        await recordEstimatedCost(env, row, attempt);
        await finish(env, row, quantResult(snapshot, 'The AI ranking timed out, so this run used the quantitative ranking.'));
      }
      return;
    }
    if (outcome === 'failed') { await finish(env, row, quantResult(snapshot, 'The AI request failed, so this run used the quantitative ranking.')); return; }
  }
  // completed: parse and sanitize, falling back to the quant result on any defect.
  await setProgress(env, row, withStep(progressOf(row), 'allocating', stamp(env)));
  const refreshed = (await env.db.prepare('SELECT * FROM recommendation_attempts WHERE id=?').bind(attempt.id).first<Attempt>())!;
  let sanitized: MonthlyPicksResearch | null = null;
  try {
    const response = JSON.parse(refreshed.response!) as ProviderResponse;
    sanitized = sanitizePicks(JSON.parse(outputText(response)), snapshot);
  } catch { sanitized = null; }
  await finish(env, row, sanitized ?? quantResult(snapshot, 'The AI ranking could not be used (invalid or empty response), so this run used the quantitative ranking instead.'));
}

// ---------------------------------------------------------------- leases and the processor

/**
 * Takes the run's lease if nobody holds a live one. Compare-and-set in one statement, so of any
 * number of concurrent workers exactly one proceeds.
 */
export async function claimLease(env: RunEnv, id: string): Promise<{ token: string; row: Row } | null> {
  const token = crypto.randomUUID();
  const at = stamp(env);
  const expires = new Date(clock(env).getTime() + LEASE_MS).toISOString();
  const claimed = await env.db.prepare(`UPDATE monthly_recommendations SET lease_token=?,lease_expires_at=?
    WHERE id=? AND status IN ('queued','gathering','in_progress') AND (lease_token IS NULL OR lease_expires_at<=?)`)
    .bind(token, expires, id, at).run();
  if (!claimed.meta.changes) return null;
  const row = await env.db.prepare('SELECT * FROM monthly_recommendations WHERE id=?').bind(id).first<Row>();
  return row ? { token, row } : null;
}

/** One step of one run under a lease. Safe to call from many workers at once. Never throws. */
export async function advanceRun(env: RunEnv, id: string): Promise<Row | null> {
  const lease = await claimLease(env, id);
  if (!lease) return env.db.prepare('SELECT * FROM monthly_recommendations WHERE id=?').bind(id).first<Row>();
  const held: Lease = { ...env, token: lease.token };
  const { row } = lease;
  try {
    if (clock(env).getTime() - Date.parse(row.created_at) > MAX_RUN_AGE_MS) {
      await setState(held, row, 'failed', 'This run did not finish within 30 minutes and was stopped. Start a new run.');
    } else if (row.workflow_version < MIN_ADVANCE_VERSION) {
      await setState(held, row, 'needs_attention', 'This run started under an earlier workflow. Its saved data is preserved; start a fresh run.');
    } else if (row.status === 'gathering') {
      await advanceGathering(held, row);
    } else {
      await advanceRanking(held, row);
    }
  } catch (error) {
    // Transient failure (D1, provider): keep the run, record the retry, back off. The age ceiling above ends it.
    const progress = progressOf(row);
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Unexpected error';
    console.error(`Monthly Picks run ${id} step failed`, error);
    await guarded(held, row, 'UPDATE monthly_recommendations SET progress=?,next_attempt_at=?,updated_at=? WHERE id=? AND user_id=?',
      JSON.stringify({ ...progress, retries: progress.retries + 1, message: `A step failed and will be retried: ${message}`, updatedAt: stamp(env) }),
      new Date(clock(env).getTime() + RETRY_BACKOFF_MS).toISOString(), stamp(env)).catch(() => {});
  } finally {
    // Release only our own lease; a successor's lease is never touched.
    await env.db.prepare('UPDATE monthly_recommendations SET lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?')
      .bind(id, lease.token).run().catch(() => {});
  }
  return env.db.prepare('SELECT * FROM monthly_recommendations WHERE id=?').bind(id).first<Row>();
}

/** Cron entry point: advance every due active run (bounded per tick). */
export async function processDueRuns(env: RunEnv, limit = 3): Promise<{ advanced: string[]; skipped: number }> {
  const at = stamp(env);
  const due = (await env.db.prepare(`SELECT id FROM monthly_recommendations
    WHERE status IN ('queued','gathering','in_progress') AND (next_attempt_at IS NULL OR next_attempt_at<=?)
    AND (lease_token IS NULL OR lease_expires_at<=?) ORDER BY updated_at ASC LIMIT ?`).bind(at, at, limit).all<{ id: string }>()).results;
  const advanced: string[] = [];
  for (const { id } of due) {
    await advanceRun(env, id);
    advanced.push(id);
  }
  return { advanced, skipped: 0 };
}

// ---------------------------------------------------------------- starting a run

export type StartInput = {
  month: unknown; amount: unknown; feePct?: unknown; shortlist: unknown; rerun?: unknown; idempotencyKey?: unknown;
};

/** Validates, creates (or reuses) a run, requests missing facts, and takes the first step. Returns promptly. */
export async function startRun(env: RunEnv, owner: string, body: StartInput) {
  const portfolio = await readPortfolio(env, owner);
  const month = typeof body.month === 'string' ? body.month : '';
  const amount = Number(body.amount), fee = Number(body.feePct ?? 0);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new UserError('Choose a valid month.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw new UserError('Enter a valid investment amount.');
  if (!Number.isFinite(fee) || fee < 0 || fee > 10) throw new UserError('Fee estimate must be between 0% and 10%.');
  if (!Array.isArray(body.shortlist) || body.shortlist.some((ticker) => typeof ticker !== 'string')) throw new UserError('Choose 1–15 companies.');
  const shortlist = [...new Set((body.shortlist as string[]).map((ticker) => ticker.trim().toUpperCase()))].sort();
  if (!shortlist.length || shortlist.length > 15) throw new UserError('Choose 1–15 companies.');
  if (shortlist.some((ticker) => !portfolio.companies.some((company) => company.ticker === ticker))) throw new UserError('Unknown shortlisted company.');
  const key = typeof body.idempotencyKey === 'string' && /^[\w-]{8,64}$/.test(body.idempotencyKey) ? body.idempotencyKey : null;

  // The same key always answers with the same run, however many times the request is repeated.
  if (key) {
    const repeated = await env.db.prepare('SELECT * FROM monthly_recommendations WHERE user_id=? AND idempotency_key=?').bind(owner, key).first<Row>();
    if (repeated) return viewOne(env, repeated);
  }

  // Reuse only a completed run with identical inputs and same-day data; failed/old runs always start fresh.
  const day = today();
  const previous = (await env.db.prepare('SELECT * FROM monthly_recommendations WHERE user_id=? AND month=? AND amount=? AND fee_pct=? ORDER BY created_at DESC').bind(owner, month, amount, fee).all<Row>()).results;
  // A saved result is only reused when the holdings it was sized against are unchanged.
  const currentFingerprint = holdingsFingerprint(await heldValues(env, owner));
  const existing = previous.find((row) => {
    const saved = row.result ? (JSON.parse(row.result) as MonthlyPicksResearch) : null;
    return canReuseRun({
      status: row.status, workflowVersion: row.workflow_version, shortlist: parseList(row.shortlist),
      dataAsOf: saved?.dataAsOf ?? null,
    }, shortlist, day, WORKFLOW_VERSION) && saved?.sizing?.holdingsFingerprint === currentFingerprint;
  });
  if (existing && body.rerun !== true) return viewOne(env, existing);

  // One active run per account. A stalled one is advanced (it times itself out) rather than blocking forever.
  const running = await env.db.prepare("SELECT * FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','gathering','in_progress') LIMIT 1").bind(owner).first<Row>();
  if (running) return viewOne(env, (await advanceRun(env, running.id)) ?? running);

  const id = crypto.randomUUID(), timestamp = stamp(env);
  const progress = JSON.stringify(withStep(newProgress(shortlist.length, timestamp), 'gathering', timestamp, { message: 'Checking which company data is up to date.' }));
  const saved = await env.db.prepare(`INSERT INTO monthly_recommendations
    (id,user_id,month,amount,fee_pct,shortlist,status,model,workflow_version,gather_started_at,progress,idempotency_key,created_at,updated_at)
    SELECT ?,?,?,?,?,?,'gathering',?,?,?,?,?,?,? WHERE NOT EXISTS
    (SELECT 1 FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','gathering','in_progress'))`)
    .bind(id, owner, month, amount, fee, JSON.stringify(shortlist), MODEL, WORKFLOW_VERSION, timestamp, progress, key, timestamp, timestamp, owner).run()
    .catch(async (error) => {
      // A concurrent request with the same idempotency key won the unique index.
      if (key && /UNIQUE/i.test(String(error?.message ?? error))) return { meta: { changes: 0 } };
      throw error;
    });
  if (!saved.meta.changes) {
    const current = (key ? await env.db.prepare('SELECT * FROM monthly_recommendations WHERE user_id=? AND idempotency_key=?').bind(owner, key).first<Row>() : null)
      ?? await env.db.prepare("SELECT * FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','gathering','in_progress') LIMIT 1").bind(owner).first<Row>();
    if (!current) throw new UserError('Another research request is starting.');
    return viewOne(env, current);
  }

  // Ask GitHub Actions to scrape whatever isn't fresh; the run waits in 'gathering' until it lands.
  const stale = (await readFactsStatus(env.db, shortlist)).filter(needsScrape).map((status) => status.ticker);
  // Over the daily dispatch limit the run simply uses the cached company data.
  if (stale.length && dispatchEnabled(env.dispatch) && (await takeRateLimit(env.db, owner, 'facts-dispatch', FACTS_DISPATCH_LIMIT)).allowed) {
    const result = await requestFacts(env.db, env.dispatch, stale);
    if (result.waiting) {
      const waiting = withStep(JSON.parse(progress) as RunProgress, 'gathering', timestamp, {
        pending: stale, completed: shortlist.length - stale.length, total: shortlist.length,
        message: `Waiting for PSX company data for ${stale.length} of ${shortlist.length} companies.`,
      });
      await env.db.prepare('UPDATE monthly_recommendations SET pending_tickers=?,progress=?,updated_at=? WHERE id=? AND user_id=?')
        .bind(JSON.stringify(stale), JSON.stringify(waiting), stamp(env), id, owner).run();
      return viewOne(env, (await readRow(env, id, owner))!);
    }
  }
  return viewOne(env, (await advanceRun(env, id)) ?? (await readRow(env, id, owner))!);
}

/** Requests a facts scrape without starting a run. */
export async function refreshFacts(env: RunEnv, owner: string, tickers: unknown) {
  const portfolio = await readPortfolio(env, owner);
  const list = Array.isArray(tickers) ? tickers.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toUpperCase()) : [];
  const owned = list.filter((ticker) => portfolio.companies.some((company) => company.ticker === ticker)).slice(0, 40);
  if (!owned.length) throw new UserError('Choose companies to refresh.');
  const limit = await takeRateLimit(env.db, owner, 'facts-dispatch', FACTS_DISPATCH_LIMIT);
  if (!limit.allowed)
    throw new UserError(`Company data refreshes are limited to ${FACTS_DISPATCH_LIMIT.max} a day. Try again in ${waitText(limit.retryAfterMs)}.`, 429);
  const result = await requestFacts(env.db, env.dispatch, owned);
  return { dispatched: result.dispatched, waiting: result.waiting, reason: result.reason ?? null };
}

// ---------------------------------------------------------------- watchdog / health

export type PicksHealth = {
  now: string;
  activeRuns: number;
  oldestActiveRunAgeSec: number | null;
  stuckRuns: number;
  failedLast24h: number;
  completedLast24h: number;
  lastCompletedAt: string | null;
  lastFactsFetchedAt: string | null;
  lastQuoteFetchedAt: string | null;
  quoteLagMinutes: number | null;
  recentFactsErrors: { ticker: string; error: string; attemptedAt: string | null }[];
  providerRequests24h: number;
  marketOpen: boolean;
  /** On-demand facts scrapes requested over 15 minutes ago that never settled. */
  unsettledFactsRequests: number;
  warnings: string[];
};

/** Operational snapshot for administrators: is the processor alive, are runs stuck, is data arriving. */
export async function picksHealth(env: RunEnv): Promise<PicksHealth> {
  const nowDate = clock(env), at = nowDate.toISOString();
  const dayAgo = new Date(nowDate.getTime() - 86_400_000).toISOString();
  const stuckBefore = new Date(nowDate.getTime() - 10 * 60_000).toISOString();
  const one = async <T,>(sql: string, ...params: unknown[]) => env.db.prepare(sql).bind(...params).first<T>();
  const active = await one<{ n: number; oldest: string | null }>("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM monthly_recommendations WHERE status IN ('queued','gathering','in_progress')");
  const stuck = await one<{ n: number }>("SELECT COUNT(*) AS n FROM monthly_recommendations WHERE status IN ('queued','gathering','in_progress') AND updated_at<?", stuckBefore);
  const failed = await one<{ n: number }>("SELECT COUNT(*) AS n FROM monthly_recommendations WHERE status='failed' AND updated_at>=?", dayAgo);
  const completed = await one<{ n: number; last: string | null }>("SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM monthly_recommendations WHERE status='completed' AND updated_at>=?", dayAgo);
  const facts = await one<{ last: string | null }>('SELECT MAX(fetched_at) AS last FROM company_facts');
  const quote = await one<{ last: string | null }>('SELECT MAX(fetched_at) AS last FROM quote_refreshes');
  const errors = (await env.db.prepare('SELECT ticker,error,attempted_at FROM facts_requests WHERE error IS NOT NULL ORDER BY attempted_at DESC LIMIT 5').all<{ ticker: string; error: string; attempted_at: string | null }>()).results;
  const requests = await one<{ n: number }>("SELECT COUNT(*) AS n FROM recommendation_attempts WHERE created_at>=?", dayAgo);
  const quoteLagMinutes = quote?.last ? Math.round((nowDate.getTime() - Date.parse(quote.last)) / 60_000) : null;
  const market = pakistanMarketState(nowDate);
  const unsettled = await one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM facts_requests WHERE (attempted_at IS NULL OR attempted_at<requested_at) AND requested_at<?',
    new Date(nowDate.getTime() - 15 * 60_000).toISOString(),
  );
  const warnings: string[] = [];
  // Missed ingestion: during a session the GitHub scraper should land a quote refresh every few minutes
  // (GitHub may delay or drop scheduled runs, so a gap is worth surfacing, not assuming).
  if (market.isOpen && (quoteLagMinutes === null || quoteLagMinutes > 30))
    warnings.push(`The market is open but the newest quote is ${quoteLagMinutes === null ? 'missing' : `${quoteLagMinutes} minutes old`}. Check the PSX quotes workflow.`);
  if ((unsettled?.n ?? 0) > 0) warnings.push(`${unsettled!.n} company-data request(s) were dispatched over 15 minutes ago and never finished.`);
  if ((stuck?.n ?? 0) > 0) warnings.push(`${stuck!.n} active run(s) have not progressed for over 10 minutes — check that the quote-refresh Worker cron (every minute) is deployed and running.`);
  if (!facts?.last) warnings.push('No company facts have ever been stored.');
  if (quoteLagMinutes !== null && quoteLagMinutes > 24 * 60 * 3) warnings.push('Quote cache has not been updated for over three days.');
  return {
    now: at,
    activeRuns: active?.n ?? 0,
    oldestActiveRunAgeSec: active?.oldest ? Math.round((nowDate.getTime() - Date.parse(active.oldest)) / 1000) : null,
    stuckRuns: stuck?.n ?? 0,
    failedLast24h: failed?.n ?? 0,
    completedLast24h: completed?.n ?? 0,
    lastCompletedAt: completed?.last ?? null,
    lastFactsFetchedAt: facts?.last ?? null,
    lastQuoteFetchedAt: quote?.last ?? null,
    quoteLagMinutes,
    recentFactsErrors: errors.map((e) => ({ ticker: e.ticker, error: e.error, attemptedAt: e.attempted_at })),
    providerRequests24h: requests?.n ?? 0,
    marketOpen: market.isOpen,
    unsettledFactsRequests: unsettled?.n ?? 0,
    warnings,
  };
}
