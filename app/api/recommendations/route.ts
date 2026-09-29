import { env } from 'cloudflare:workers';
import { blankPortfolio, today, type Portfolio } from '@/lib/portfolio';
import { db, failure, identity } from '@/lib/server';
import { gatherFacts } from '@/lib/company-facts-store';
import { computeMetrics, quantScore, type CompanyMetrics, type CompanyScore } from '@/lib/company-facts';
import {
  WORKFLOW_VERSION, MODEL, BUDGET_USD, PICK_RESERVE,
  pickRequest, sanitizePicks, quantResult, outputText, usage,
  type ProviderResponse, type SnapshotV8,
} from '@/lib/monthly-picks-ai';
import type { MonthlyPicksResearch } from '@/lib/monthly-picks';

type Row = {
  id: string; user_id: string; month: string; amount: number; fee_pct: number; shortlist: string;
  status: string; provider_response_id: string | null; result: string | null; sources: string | null;
  error: string | null; model: string; estimated_cost_usd: number | null; workflow_version: number;
  snapshot: string | null; created_at: string; updated_at: string;
};
type Attempt = {
  id: string; recommendation_id: string; phase: string; cycle: number; batch_key: string; state: string;
  provider_response_id: string | null; request: string; response: string | null;
  reserved_usd: number; cost_usd: number | null; error: string | null; created_at: string;
};

const now = () => new Date().toISOString();
const active = ['queued', 'in_progress'];
const SUBMIT_STUCK_MS = 120_000;
const RUN_TIMEOUT_MS = 5 * 60_000;
const privateJson = (body: unknown) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
const readRow = (id: string, owner: string) => db().prepare('SELECT * FROM monthly_recommendations WHERE id=? AND user_id=?').bind(id, owner).first<Row>();
async function attempts(id: string) {
  return (await db().prepare('SELECT * FROM recommendation_attempts WHERE recommendation_id=? ORDER BY cycle,created_at,id').bind(id).all<Attempt>()).results;
}
function publicRow(row: Row) {
  return {
    id: row.id, month: row.month, amount: row.amount, feePct: row.fee_pct,
    shortlist: JSON.parse(row.shortlist), status: row.status,
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
function committed(rows: Attempt[]) {
  return rows.reduce((sum, attempt) => sum + (attempt.cost_usd ?? attempt.reserved_usd), 0);
}

async function buildSnapshot(row: Pick<Row, 'month' | 'amount' | 'created_at'>, shortlist: string[]): Promise<SnapshotV8> {
  const dataAsOf = today();
  const facts = await gatherFacts(shortlist);
  const metrics: CompanyMetrics[] = facts.map((f) => computeMetrics(f, dataAsOf));
  const scores: CompanyScore[] = quantScore(metrics);
  const companies = facts.map((f, index) => ({
    ticker: f.ticker,
    name: 'unavailable' in f ? f.ticker : f.name,
    sector: 'unavailable' in f ? 'Unknown' : f.sector,
    source: 'unavailable' in f ? null : f.source,
    price: 'unavailable' in f ? null : f.price,
    priceDate: 'unavailable' in f ? null : f.priceDate,
    metrics: metrics[index],
  }));
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

async function advanceV8(row: Row) {
  const list = await attempts(row.id);
  const attempt = list.find((a) => a.phase === 'pick');
  if (!attempt) { await setState(row, 'failed', 'Its evidence reservation is missing.'); return; }
  const snapshot = JSON.parse(row.snapshot!) as SnapshotV8;

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

async function view(row: Row) {
  const list = row.workflow_version >= WORKFLOW_VERSION ? await attempts(row.id) : [];
  return {
    ...publicRow(row),
    phase: active.includes(row.status) ? 'ranking' : undefined,
    budgetCommittedUsd: committed(list),
    method: row.result ? (JSON.parse(row.result) as MonthlyPicksResearch).method : undefined,
    dataAsOf: row.result ? (JSON.parse(row.result) as MonthlyPicksResearch).dataAsOf : undefined,
  };
}

export async function GET(req: Request) {
  try {
    const owner = await identity(req);
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      const rows = (await db().prepare('SELECT * FROM monthly_recommendations WHERE user_id=? ORDER BY created_at DESC LIMIT 20').bind(owner).all<Row>()).results;
      return privateJson({ recommendations: await Promise.all(rows.map(view)) });
    }
    let row = await readRow(id, owner);
    if (!row) return failure(Error('Recommendation not found.'), 404);
    if (active.includes(row.status) && row.workflow_version < WORKFLOW_VERSION) {
      await setState(row, 'needs_attention', 'This run started under an earlier workflow. Its saved data is preserved; start a fresh run.');
      row = (await readRow(id, owner))!;
    } else if (active.includes(row.status) && row.workflow_version >= WORKFLOW_VERSION) {
      if (!env.OPENAI_API_KEY) throw Error('The secure AI connection is not configured.');
      await advanceV8(row);
      row = (await readRow(id, owner))!;
    }
    return privateJson(await view(row));
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const owner = await identity(req, true);
    const body = await req.json() as Record<string, unknown>;
    const month = typeof body.month === 'string' ? body.month : '';
    const amount = Number(body.amount), fee = Number(body.feePct ?? 0);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Choose a valid month.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw Error('Enter a valid investment amount.');
    if (!Number.isFinite(fee) || fee < 0 || fee > 10) throw Error('Fee estimate must be between 0% and 10%.');
    if (!Array.isArray(body.shortlist) || body.shortlist.some((ticker) => typeof ticker !== 'string')) throw Error('Choose 1–15 companies.');
    const shortlist = [...new Set((body.shortlist as string[]).map((ticker) => ticker.trim().toUpperCase()))].sort();
    if (!shortlist.length || shortlist.length > 15) throw Error('Choose 1–15 companies.');
    const savedPortfolio = await db().prepare('SELECT payload FROM portfolios WHERE user_id=?').bind(owner).first<{ payload: string }>();
    const portfolio: Portfolio = savedPortfolio ? JSON.parse(savedPortfolio.payload) : blankPortfolio();
    if (shortlist.some((ticker) => !portfolio.companies.some((company) => company.ticker === ticker))) throw Error('Unknown shortlisted company.');

    const previous = (await db().prepare('SELECT * FROM monthly_recommendations WHERE user_id=? AND month=? AND amount=? AND fee_pct=? ORDER BY created_at DESC').bind(owner, month, amount, fee).all<Row>()).results;
    const existing = previous.find((row) => row.workflow_version === WORKFLOW_VERSION && JSON.stringify((JSON.parse(row.shortlist) as string[]).sort()) === JSON.stringify(shortlist));
    if (existing && body.rerun !== true) return privateJson(await view(existing));

    const id = crypto.randomUUID(), timestamp = now();
    const snapshot = await buildSnapshot({ month, amount, created_at: timestamp }, shortlist);
    const usableCompanies = snapshot.companies.filter((c) => !c.metrics.unavailable);

    const saved = await db().prepare(`INSERT INTO monthly_recommendations
      (id,user_id,month,amount,fee_pct,shortlist,status,model,workflow_version,snapshot,created_at,updated_at)
      SELECT ?,?,?,?,?,?,'queued',?,?,?,?,? WHERE NOT EXISTS
      (SELECT 1 FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','in_progress'))`)
      .bind(id, owner, month, amount, fee, JSON.stringify(shortlist), MODEL, WORKFLOW_VERSION, JSON.stringify(snapshot), timestamp, timestamp, owner).run();
    if (!saved.meta.changes) {
      const running = await db().prepare("SELECT * FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','in_progress') LIMIT 1").bind(owner).first<Row>();
      if (!running) throw Error('Another research request is starting.');
      return privateJson(await view(running));
    }
    const row = (await readRow(id, owner))!;

    if (!usableCompanies.length) {
      await setState(row, 'failed', 'PSX did not return usable data for any shortlisted company today. No cost was incurred.');
      return privateJson(await view((await readRow(id, owner))!));
    }
    if (!env.OPENAI_API_KEY) {
      // No AI key configured: the quant fallback is still a complete result, so
      // produce it immediately instead of failing the run.
      await finish(row, quantResult(snapshot));
      return privateJson(await view((await readRow(id, owner))!));
    }
    const attempt = await createAttempt(row, pickRequest(snapshot), PICK_RESERVE);
    if (!attempt) throw Error('The research budget cannot safely reserve this workflow.');
    await submit(row, attempt);
    return privateJson(await view((await readRow(id, owner))!));
  } catch (error) { return failure(error); }
}
