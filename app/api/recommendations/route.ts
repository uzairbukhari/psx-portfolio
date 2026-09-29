import { env } from 'cloudflare:workers';
import { blankPortfolio, today, type Portfolio } from '@/lib/portfolio';
import { db, failure, identity } from '@/lib/server';
import { readFacts, readFactsStatus } from '@/lib/company-facts-store';
import { computeMetrics, overlayQuote, quantScore, type CompanyMetrics, type CompanyScore } from '@/lib/company-facts';
import { readQuoteRows } from '@/lib/quote-cache';
import { dispatchEnabled, requestFacts } from '@/lib/github-dispatch';
import {
  canReuseRun, needsScrape, nextGatherStep, unavailableReason, FACTS_MAX_AGE_DAYS,
} from '@/lib/monthly-picks-flow';
import {
  WORKFLOW_VERSION, MIN_ADVANCE_VERSION, MODEL, BUDGET_USD, PICK_RESERVE,
  pickRequest, sanitizePicks, quantResult, outputText, usage,
  type ProviderResponse, type SnapshotV8,
} from '@/lib/monthly-picks-ai';
import type { MonthlyPicksResearch } from '@/lib/monthly-picks';

type Row = {
  id: string; user_id: string; month: string; amount: number; fee_pct: number; shortlist: string;
  status: string; provider_response_id: string | null; result: string | null; sources: string | null;
  error: string | null; model: string; estimated_cost_usd: number | null; workflow_version: number;
  snapshot: string | null; gather_started_at: string | null; pending_tickers: string | null;
  created_at: string; updated_at: string;
};
type Attempt = {
  id: string; recommendation_id: string; phase: string; cycle: number; batch_key: string; state: string;
  provider_response_id: string | null; request: string; response: string | null;
  reserved_usd: number; cost_usd: number | null; error: string | null; created_at: string;
};

const now = () => new Date().toISOString();
const active = ['queued', 'gathering', 'in_progress'];
const SUBMIT_STUCK_MS = 120_000;
const RUN_TIMEOUT_MS = 5 * 60_000;
// An active run nobody has polled for this long is advanced (or timed out) by the next POST.
const STALE_RUN_MS = 10 * 60_000;
const privateJson = (body: unknown) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
const readRow = (id: string, owner: string) => db().prepare('SELECT * FROM monthly_recommendations WHERE id=? AND user_id=?').bind(id, owner).first<Row>();
async function attempts(id: string) {
  return (await db().prepare('SELECT * FROM recommendation_attempts WHERE recommendation_id=? ORDER BY cycle,created_at,id').bind(id).all<Attempt>()).results;
}
const parseList = (value: string | null): string[] => {
  try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};
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
async function setState(row: Row, status: string, error: string | null = null) {
  await db().prepare('UPDATE monthly_recommendations SET status=?,error=?,updated_at=? WHERE id=? AND user_id=?')
    .bind(status, error, now(), row.id, row.user_id).run();
}

async function buildSnapshot(row: Pick<Row, 'month' | 'amount' | 'created_at'>, shortlist: string[]): Promise<SnapshotV8> {
  const dataAsOf = today();
  const entries = await readFacts(shortlist);
  const quotes = new Map((await readQuoteRows(db()).catch(() => [])).map((quote) => [quote.ticker, quote]));
  const metrics: CompanyMetrics[] = entries.map(({ status, facts }) => {
    if (!facts) return computeMetrics({ ticker: status.ticker, unavailable: unavailableReason(status) }, dataAsOf);
    const quote = quotes.get(status.ticker);
    const computed = computeMetrics(
      overlayQuote(facts, quote && { price: quote.price, quoteDate: quote.quote_date, fetchedAt: quote.fetched_at }), dataAsOf,
    );
    if (status.state === 'stale') computed.dataGaps.push(`Company data is ${status.ageDays} days old (limit ${FACTS_MAX_AGE_DAYS}); the latest scrape failed or is pending.`);
    return computed;
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
  };
}

async function createAttempt(row: Row, request: unknown, reserve: number) {
  const id = `${row.id}:0:pick:final`;
  await db().prepare(`INSERT OR IGNORE INTO recommendation_attempts
    (id,recommendation_id,phase,cycle,batch_key,state,request,reserved_usd,created_at)
    SELECT ?,?,?,?,?,'pending',?,?,? WHERE
    COALESCE((SELECT SUM(CASE WHEN cost_usd IS NULL THEN reserved_usd ELSE cost_usd END)
      FROM recommendation_attempts WHERE recommendation_id=?),0)+?<=?`)
    .bind(id, row.id, 'pick', 0, 'final', JSON.stringify(request), reserve, now(), row.id, reserve, BUDGET_USD).run();
  return db().prepare('SELECT * FROM recommendation_attempts WHERE id=?').bind(id).first<Attempt>();
}
async function submit(row: Row, attempt: Attempt) {
  const claimed = await db().prepare("UPDATE recommendation_attempts SET state='submitting' WHERE id=? AND state='pending'").bind(attempt.id).run();
  if (!claimed.meta.changes) return;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000), body: attempt.request,
    });
    const result = await response.json() as ProviderResponse;
    if (!response.ok || !result.id) throw Error(result.error?.message ?? `OpenAI request failed (${response.status}).`);
    await db().batch([
      db().prepare("UPDATE recommendation_attempts SET state='in_progress',provider_response_id=? WHERE id=?").bind(result.id, attempt.id),
      db().prepare("UPDATE monthly_recommendations SET status='in_progress',provider_response_id=?,updated_at=? WHERE id=? AND user_id=?")
        .bind(result.id, now(), row.id, row.user_id),
    ]);
  } catch (error) {
    const message = `Submission could not be confirmed. ${error instanceof Error ? error.message : ''}`.slice(0, 1000);
    await db().prepare("UPDATE recommendation_attempts SET state='uncertain',error=? WHERE id=?").bind(message, attempt.id).run();
  }
}
async function archive(row: Row, attempt: Attempt, response: ProviderResponse) {
  const measured = usage(response);
  const state = response.status === 'completed' ? 'completed' : 'failed';
  await db().batch([
    db().prepare('UPDATE recommendation_attempts SET state=?,response=?,cost_usd=? WHERE id=?')
      .bind(state, JSON.stringify(response), measured.cost, attempt.id),
    db().prepare('INSERT OR IGNORE INTO ai_usage (id,user_id,source,model,input_tokens,output_tokens,cached_tokens,cost_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(`monthly:${attempt.id}`, row.user_id, 'monthly_picks', MODEL, measured.input, measured.output, measured.cached, measured.cost, now()),
    db().prepare(`UPDATE monthly_recommendations SET estimated_cost_usd=(SELECT SUM(cost_usd) FROM recommendation_attempts WHERE recommendation_id=?),updated_at=? WHERE id=? AND user_id=?`)
      .bind(row.id, now(), row.id, row.user_id),
  ]);
}
async function retrieve(row: Row, attempt: Attempt): Promise<'pending' | 'completed' | 'failed'> {
  if (!attempt.provider_response_id) return 'failed';
  const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(attempt.provider_response_id)}`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) return 'pending';
  const result = await response.json() as ProviderResponse;
  if (active.includes(result.status ?? '')) return 'pending';
  await archive(row, attempt, result);
  return result.status === 'completed' ? 'completed' : 'failed';
}
async function finish(row: Row, result: MonthlyPicksResearch) {
  await db().prepare('UPDATE monthly_recommendations SET status=?,result=?,sources=?,error=?,updated_at=? WHERE id=? AND user_id=?')
    .bind('completed', JSON.stringify(result), JSON.stringify([]), null, now(), row.id, row.user_id).run();
}

/** Turns a run with a stored snapshot into a ranking: AI call when possible, quant result otherwise. */
async function beginRanking(row: Row, snapshot: SnapshotV8) {
  const usable = snapshot.companies.filter((company) => !company.metrics.unavailable);
  if (!usable.length) {
    const reasons = snapshot.companies.slice(0, 3).map((company) => `${company.ticker}: ${company.metrics.unavailable}`).join(' ');
    await setState(row, 'failed', `No shortlisted company has usable PSX data yet. ${reasons}`.slice(0, 600));
    return;
  }
  if (!env.OPENAI_API_KEY) { await finish(row, quantResult(snapshot)); return; }
  const attempt = await createAttempt(row, pickRequest(snapshot), PICK_RESERVE);
  // Budget can't cover the AI call: the deterministic result is still a complete answer.
  if (!attempt) { await finish(row, quantResult(snapshot)); return; }
  await submit(row, attempt);
}

/** Gathering: wait for the on-demand scrape, then snapshot the facts and start ranking. */
async function advanceGathering(row: Row) {
  const pending = parseList(row.pending_tickers);
  if (pending.length) {
    const step = nextGatherStep({
      startedAt: row.gather_started_at ?? row.created_at, now: Date.now(), pending: await readFactsStatus(pending),
    });
    if (step.action === 'wait') {
      if (JSON.stringify(step.pending) !== JSON.stringify(pending)) {
        await db().prepare("UPDATE monthly_recommendations SET pending_tickers=?,updated_at=? WHERE id=? AND user_id=? AND status='gathering'")
          .bind(JSON.stringify(step.pending), now(), row.id, row.user_id).run();
      }
      return;
    }
  }
  const snapshot = await buildSnapshot(row, parseList(row.shortlist));
  // Exactly one poller wins this transition; the rest just re-read the row.
  const claimed = await db().prepare("UPDATE monthly_recommendations SET status='in_progress',snapshot=?,pending_tickers=NULL,updated_at=? WHERE id=? AND user_id=? AND status='gathering'")
    .bind(JSON.stringify(snapshot), now(), row.id, row.user_id).run();
  if (!claimed.meta.changes) return;
  await beginRanking({ ...row, status: 'in_progress', snapshot: JSON.stringify(snapshot) }, snapshot);
}

async function advanceRanking(row: Row) {
  const snapshot = JSON.parse(row.snapshot ?? 'null') as SnapshotV8 | null;
  if (!snapshot) { await setState(row, 'failed', 'This run has no saved data snapshot.'); return; }
  const attempt = (await attempts(row.id)).find((a) => a.phase === 'pick');
  if (!attempt) { await beginRanking(row, snapshot); return; }
  if (!env.OPENAI_API_KEY) { await finish(row, quantResult(snapshot)); return; }

  if (attempt.state === 'uncertain' || attempt.state === 'failed') {
    await finish(row, quantResult(snapshot));
    return;
  }
  if (attempt.state === 'submitting') {
    if (Date.now() - Date.parse(attempt.created_at) > SUBMIT_STUCK_MS) await finish(row, quantResult(snapshot));
    return;
  }
  if (attempt.state === 'pending') { await submit(row, attempt); return; }
  if (attempt.state === 'in_progress') {
    const outcome = await retrieve(row, attempt);
    if (outcome === 'pending') {
      if (Date.now() - Date.parse(attempt.created_at) > RUN_TIMEOUT_MS) await finish(row, quantResult(snapshot));
      return;
    }
    if (outcome === 'failed') { await finish(row, quantResult(snapshot)); return; }
  }
  // completed: parse and sanitize, falling back to the quant result on any defect.
  const refreshed = (await db().prepare('SELECT * FROM recommendation_attempts WHERE id=?').bind(attempt.id).first<Attempt>())!;
  let sanitized: MonthlyPicksResearch | null = null;
  try {
    const response = JSON.parse(refreshed.response!) as ProviderResponse;
    sanitized = sanitizePicks(JSON.parse(outputText(response)), snapshot);
  } catch { sanitized = null; }
  await finish(row, sanitized ?? quantResult(snapshot));
}

/** Moves an active run forward one step (idempotent under concurrent polls) and returns its fresh row. */
async function advance(row: Row): Promise<Row> {
  if (!active.includes(row.status)) return row;
  if (row.workflow_version < MIN_ADVANCE_VERSION) {
    await setState(row, 'needs_attention', 'This run started under an earlier workflow. Its saved data is preserved; start a fresh run.');
  } else if (row.status === 'gathering') {
    await advanceGathering(row);
  } else {
    await advanceRanking(row);
  }
  return (await readRow(row.id, row.user_id)) ?? row;
}

async function costs(owner: string) {
  const rows = (await db().prepare(`SELECT a.recommendation_id AS id,
      SUM(CASE WHEN a.cost_usd IS NULL THEN a.reserved_usd ELSE a.cost_usd END) AS cost
    FROM recommendation_attempts a JOIN monthly_recommendations r ON r.id=a.recommendation_id
    WHERE r.user_id=? GROUP BY a.recommendation_id`).bind(owner).all<{ id: string; cost: number }>()).results;
  return new Map(rows.map((row) => [row.id, row.cost]));
}
function view(row: Row, committedUsd = 0) {
  const result = row.result ? (JSON.parse(row.result) as MonthlyPicksResearch) : null;
  return {
    ...publicRow(row),
    phase: row.status === 'gathering' ? 'gathering' : active.includes(row.status) ? 'ranking' : undefined,
    progress: active.includes(row.status)
      ? { phase: row.status === 'gathering' ? 'gathering' : 'ranking', pending: parseList(row.pending_tickers), startedAt: row.gather_started_at ?? row.created_at }
      : undefined,
    budgetCommittedUsd: committedUsd,
    method: result?.method,
    dataAsOf: result?.dataAsOf,
  };
}
async function viewOne(row: Row) {
  const list = row.workflow_version >= MIN_ADVANCE_VERSION ? await attempts(row.id) : [];
  return view(row, list.reduce((sum, attempt) => sum + (attempt.cost_usd ?? attempt.reserved_usd), 0));
}
async function readPortfolio(owner: string): Promise<Portfolio> {
  const saved = await db().prepare('SELECT payload FROM portfolios WHERE user_id=?').bind(owner).first<{ payload: string }>();
  return saved ? JSON.parse(saved.payload) : blankPortfolio();
}

export async function GET(req: Request) {
  try {
    const owner = await identity(req);
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      const rows = (await db().prepare('SELECT * FROM monthly_recommendations WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(owner).all<Row>()).results;
      const spent = await costs(owner);
      const portfolio = await readPortfolio(owner);
      const statuses = await readFactsStatus(portfolio.companies.map((company) => company.ticker)).catch(() => []);
      return privateJson({
        recommendations: rows.map((row) => view(row, spent.get(row.id) ?? 0)),
        facts: statuses.map(({ ticker, state, fetchedOn, ageDays, error }) => ({ ticker, state, fetchedOn, ageDays, error })),
        dispatchEnabled: dispatchEnabled(),
        factsMaxAgeDays: FACTS_MAX_AGE_DAYS,
      });
    }
    const row = await readRow(id, owner);
    if (!row) return failure(Error('Recommendation not found.'), 404);
    return privateJson(await viewOne(await advance(row)));
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const owner = await identity(req, true);
    const body = await req.json() as Record<string, unknown>;
    const portfolio = await readPortfolio(owner);

    if (body.action === 'refresh-facts') {
      const tickers = Array.isArray(body.tickers) ? body.tickers.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toUpperCase()) : [];
      const owned = tickers.filter((ticker) => portfolio.companies.some((company) => company.ticker === ticker)).slice(0, 40);
      if (!owned.length) throw Error('Choose companies to refresh.');
      const result = await requestFacts(owned);
      return privateJson({ dispatched: result.dispatched, waiting: result.waiting, reason: result.reason ?? null });
    }

    const month = typeof body.month === 'string' ? body.month : '';
    const amount = Number(body.amount), fee = Number(body.feePct ?? 0);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Choose a valid month.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw Error('Enter a valid investment amount.');
    if (!Number.isFinite(fee) || fee < 0 || fee > 10) throw Error('Fee estimate must be between 0% and 10%.');
    if (!Array.isArray(body.shortlist) || body.shortlist.some((ticker) => typeof ticker !== 'string')) throw Error('Choose 1–15 companies.');
    const shortlist = [...new Set((body.shortlist as string[]).map((ticker) => ticker.trim().toUpperCase()))].sort();
    if (!shortlist.length || shortlist.length > 15) throw Error('Choose 1–15 companies.');
    if (shortlist.some((ticker) => !portfolio.companies.some((company) => company.ticker === ticker))) throw Error('Unknown shortlisted company.');

    // Reuse only a completed run with identical inputs and same-day data; failed/old runs always start fresh.
    const day = today();
    const previous = (await db().prepare('SELECT * FROM monthly_recommendations WHERE user_id=? AND month=? AND amount=? AND fee_pct=? ORDER BY created_at DESC').bind(owner, month, amount, fee).all<Row>()).results;
    const existing = previous.find((row) => canReuseRun({
      status: row.status, workflowVersion: row.workflow_version, shortlist: parseList(row.shortlist),
      dataAsOf: row.result ? (JSON.parse(row.result) as MonthlyPicksResearch).dataAsOf : null,
    }, shortlist, day, WORKFLOW_VERSION));
    if (existing && body.rerun !== true) return privateJson(await viewOne(existing));

    // A run nobody is polling must not block new ones forever: advance it (which times it out).
    const running = await db().prepare("SELECT * FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','gathering','in_progress') LIMIT 1").bind(owner).first<Row>();
    if (running) {
      const latest = Date.now() - Date.parse(running.updated_at) > STALE_RUN_MS ? await advance(running) : running;
      if (active.includes(latest.status)) return privateJson(await viewOne(latest));
    }

    const id = crypto.randomUUID(), timestamp = now();
    const saved = await db().prepare(`INSERT INTO monthly_recommendations
      (id,user_id,month,amount,fee_pct,shortlist,status,model,workflow_version,gather_started_at,created_at,updated_at)
      SELECT ?,?,?,?,?,?,'gathering',?,?,?,?,? WHERE NOT EXISTS
      (SELECT 1 FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','gathering','in_progress'))`)
      .bind(id, owner, month, amount, fee, JSON.stringify(shortlist), MODEL, WORKFLOW_VERSION, timestamp, timestamp, timestamp, owner).run();
    if (!saved.meta.changes) {
      const current = await db().prepare("SELECT * FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','gathering','in_progress') LIMIT 1").bind(owner).first<Row>();
      if (!current) throw Error('Another research request is starting.');
      return privateJson(await viewOne(current));
    }
    let row = (await readRow(id, owner))!;

    // Ask GitHub Actions to scrape whatever isn't fresh; the run waits in 'gathering' until it lands.
    const stale = (await readFactsStatus(shortlist)).filter(needsScrape).map((status) => status.ticker);
    if (stale.length && dispatchEnabled()) {
      const result = await requestFacts(stale);
      if (result.waiting) {
        await db().prepare('UPDATE monthly_recommendations SET pending_tickers=?,updated_at=? WHERE id=? AND user_id=?')
          .bind(JSON.stringify(stale), now(), id, owner).run();
        return privateJson(await viewOne((await readRow(id, owner))!));
      }
    }
    row = await advance(row);
    return privateJson(await viewOne(row));
  } catch (error) { return failure(error); }
}
