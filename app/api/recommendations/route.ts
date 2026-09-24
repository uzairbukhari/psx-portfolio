import { env } from 'cloudflare:workers';
import { blankPortfolio, type Portfolio } from '@/lib/portfolio';
import { validateMonthlyPicksResearch, type MonthlyPicksResearch } from '@/lib/monthly-picks';
import { db, failure, identity } from '@/lib/server';
import {
  MODEL, BUDGET_USD, RESEARCH_RESERVE, FORMAT_RESERVE, CYCLE_RESERVE,
  researchRequest, comparisonRequest, collectSources, resolveComparison, outputText, usage,
  type ProviderResponse,
} from '@/lib/recommendation-evidence';

type Row = {
  id: string; user_id: string; month: string; amount: number; fee_pct: number; shortlist: string;
  status: string; provider_response_id: string | null; result: string | null; sources: string | null;
  error: string | null; model: string; estimated_cost_usd: number | null;
  created_at: string; updated_at: string;
};
type Attempt = {
  id: string; recommendation_id: string; phase: 'research' | 'comparison' | 'legacy'; cycle: number;
  state: string; provider_response_id: string | null; request: string; response: string | null;
  reserved_usd: number; cost_usd: number | null; error: string | null; created_at: string;
};
const now = () => new Date().toISOString();
const active = ['queued', 'in_progress'];
const privateJson = (body: unknown) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
const readRow = (id: string, owner: string) => db().prepare('SELECT * FROM monthly_recommendations WHERE id=? AND user_id=?').bind(id, owner).first<Row>();
async function attempts(id: string) {
  return (await db().prepare('SELECT * FROM recommendation_attempts WHERE recommendation_id=? ORDER BY cycle,created_at,id').bind(id).all<Attempt>()).results;
}
function publicRow(row: Row) {
  return { id: row.id, month: row.month, amount: row.amount, feePct: row.fee_pct,
    shortlist: JSON.parse(row.shortlist), status: row.status, result: row.result ? JSON.parse(row.result) : null,
    sources: row.sources ? JSON.parse(row.sources) : [], error: row.error, model: row.model,
    estimatedCostUsd: row.estimated_cost_usd, createdAt: row.created_at, updatedAt: row.updated_at };
}
function snapshot(row: Row, companies?: Portfolio['companies']) {
  const tickers: string[] = JSON.parse(row.shortlist);
  return { generatedOn: row.created_at.slice(0, 10), outlookDays: '60-90', contributionMonth: row.month,
    freshMoneyPkr: row.amount, companies: tickers.map(ticker => ({ ticker, name: companies?.find(c => c.ticker === ticker)?.name ?? ticker })) };
}
function savedSnapshot(row: Row, rows: Attempt[]) {
  const first = rows.find(a => a.phase === 'research');
  if (first) {
    const request = JSON.parse(first.request) as { input: string };
    const { gaps: _gaps, ...input } = JSON.parse(request.input) as Record<string, unknown>;
    return input;
  }
  return snapshot(row);
}
function providerResponses(rows: Attempt[]) {
  return rows.filter(a => a.response && ['research', 'legacy'].includes(a.phase)).map(a => JSON.parse(a.response!) as ProviderResponse);
}
async function setState(row: Row, status: string, error: string | null = null) {
  await db().prepare('UPDATE monthly_recommendations SET status=?,error=?,updated_at=? WHERE id=? AND user_id=?')
    .bind(status, error, now(), row.id, row.user_id).run();
}
async function createAttempt(row: Row, phase: Attempt['phase'], cycle: number, request: unknown, reserve: number) {
  const id = `${row.id}:${cycle}:${phase}`;
  // Stable ID + insert-once is the cross-request lock, before any paid submission.
  await db().prepare(`INSERT OR IGNORE INTO recommendation_attempts
    (id,recommendation_id,phase,cycle,state,request,reserved_usd,created_at)
    SELECT ?,?,?,?,'pending',?,?,? WHERE
    COALESCE((SELECT SUM(reserved_usd) FROM recommendation_attempts WHERE recommendation_id=?),0)+?<=?`)
    .bind(id, row.id, phase, cycle, JSON.stringify(request), reserve, now(), row.id, reserve, BUDGET_USD).run();
  const attempt = await db().prepare('SELECT * FROM recommendation_attempts WHERE id=?').bind(id).first<Attempt>();
  if (!attempt) throw Error('The $1 research budget is exhausted. Saved research is preserved.');
  return attempt;
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
  } catch (e) {
    // A timeout may have incurred a charge. Keep its reservation; never resubmit automatically.
    const message = `Submission could not be confirmed. No automatic paid retry. ${e instanceof Error ? e.message : ''}`.slice(0, 1000);
    await db().prepare("UPDATE recommendation_attempts SET state='uncertain',error=? WHERE id=?").bind(message, attempt.id).run();
    await setState(row, 'needs_attention', message);
  }
}
async function archive(row: Row, attempt: Attempt, response: ProviderResponse) {
  const u = usage(response);
  const state = response.status === 'completed' ? 'completed' : 'failed';
  // Raw output, citations and usage are durable even when parsing later fails.
  await db().batch([
    db().prepare('UPDATE recommendation_attempts SET state=?,response=?,cost_usd=? WHERE id=?')
      .bind(state, JSON.stringify(response), u.cost, attempt.id),
    db().prepare('INSERT OR IGNORE INTO ai_usage (id,user_id,source,model,input_tokens,output_tokens,cached_tokens,cost_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(`monthly:${attempt.id}`, row.user_id, 'monthly_picks', MODEL, u.input, u.output, u.cached, u.cost, now()),
    db().prepare(`UPDATE monthly_recommendations SET estimated_cost_usd=(SELECT SUM(cost_usd) FROM recommendation_attempts WHERE recommendation_id=?),updated_at=? WHERE id=? AND user_id=?`)
      .bind(row.id, now(), row.id, row.user_id),
  ]);
}
async function saveComparison(row: Row, result: MonthlyPicksResearch, sources: unknown) {
  const issues = result.evidenceIssues ?? [];
  await db().prepare('UPDATE monthly_recommendations SET status=?,result=?,sources=?,error=?,updated_at=? WHERE id=? AND user_id=? AND provider_response_id IS ?')
    .bind(issues.length ? 'needs_evidence' : 'completed', JSON.stringify(result), JSON.stringify(sources),
      issues.length ? 'Draft preserved. Citation or evidence gaps need repair before this comparison is ready.' : null,
      now(), row.id, row.user_id, row.provider_response_id).run();
}
async function advance(row: Row) {
  let list = await attempts(row.id);
  // Existing paid runs can be retrieved without creating a new generation.
  if (!list.length && row.provider_response_id) {
    const a = await createAttempt(row, 'legacy', 0, {}, RESEARCH_RESERVE);
    await db().prepare("UPDATE recommendation_attempts SET provider_response_id=?,state='in_progress' WHERE id=? AND state='pending'")
      .bind(row.provider_response_id, a.id).run();
    list = await attempts(row.id);
  }
  if (!list.length) {
    // Crash recovery after the parent row was saved but before first submission.
    const a = await createAttempt(row, 'research', 0, researchRequest(snapshot(row)), RESEARCH_RESERVE);
    await submit(row, a);
    return;
  }
  const cycle = Math.max(...list.map(a => a.cycle));
  const latest = list.filter(a => a.cycle === cycle);
  let a = latest.find(a => a.phase === 'comparison') ?? latest[0];
  if (a.state === 'pending') { await submit(row, a); return; }
  if (a.state === 'submitting') {
    if (Date.now() - Date.parse(a.created_at) > 120000)
      await setState(row, 'needs_attention', 'Submission status is uncertain. The budget reservation is retained; no automatic paid retry.');
    return;
  }
  if (a.state === 'uncertain' || a.state === 'failed') {
    await setState(row, 'needs_attention', a.error ?? 'The provider did not finish. Saved research is available for repair.'); return;
  }
  if (!a.response) {
    if (!a.provider_response_id) throw Error('Provider response ID is missing.');
    const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(a.provider_response_id)}?include%5B%5D=web_search_call.action.sources`, {
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) throw Error(`Could not retrieve saved research (${response.status}). No new research was started.`);
    const result = await response.json() as ProviderResponse;
    if (active.includes(result.status ?? '')) return;
    await archive(row, a, result);
    a = { ...a, response: JSON.stringify(result), state: result.status === 'completed' ? 'completed' : 'failed' };
    if (a.state === 'failed') {
      await setState(row, 'needs_attention', result.error?.message ?? `Provider stopped: ${result.incomplete_details?.reason ?? result.status}. Saved output is retained.`); return;
    }
    list = await attempts(row.id);
  }
  const responses = providerResponses(list);
  const sources = collectSources(responses);
  await db().prepare('UPDATE monthly_recommendations SET sources=? WHERE id=? AND user_id=?')
    .bind(JSON.stringify(sources), row.id, row.user_id).run();
  const tickers: string[] = JSON.parse(row.shortlist);
  if (a.phase === 'legacy') {
    try {
      const result = validateMonthlyPicksResearch(JSON.parse(outputText(JSON.parse(a.response!))), tickers, new Set(sources.map(s => s.url)));
      await saveComparison(row, result, sources);
    } catch (e) { await setState(row, 'needs_attention', `Saved response recovered; formatting needs repair. ${e instanceof Error ? e.message : ''}`); }
    return;
  }
  if (a.phase === 'research') {
    if (!sources.length) {
      await setState(row, 'needs_attention', 'The provider returned no web source metadata. All research notes are preserved; repair is required.'); return;
    }
    const next = await createAttempt(row, 'comparison', cycle, comparisonRequest(savedSnapshot(row, list), responses, tickers), FORMAT_RESERVE);
    await submit(row, next); return;
  }
  try {
    const result = resolveComparison(JSON.parse(outputText(JSON.parse(a.response!))), tickers, sources);
    await saveComparison(row, result, sources);
  } catch (e) {
    await setState(row, 'needs_attention', `Research preserved; comparison needs repair. ${e instanceof Error ? e.message : ''}`);
  }
}
async function view(row: Row) {
  const list = await attempts(row.id);
  const reserved = list.reduce((sum, a) => sum + a.reserved_usd, 0);
  const unresolved = ['failed', 'needs_evidence', 'needs_attention'].includes(row.status);
  return { ...publicRow(row), phase: list.at(-1)?.phase ?? 'research',
    canRecover: unresolved && Boolean(row.provider_response_id) && list.every(a => a.phase === 'legacy'),
    canRepair: unresolved && reserved + CYCLE_RESERVE <= BUDGET_USD,
    repairMaxCostUsd: CYCLE_RESERVE,
    researchNotes: unresolved ? providerResponses(list).map(outputText).join('\n\n') : undefined,
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
    const pending = (await attempts(row.id)).some(a => a.state === 'pending');
    if (pending && !active.includes(row.status)) {
      await setState(row, 'in_progress');
      row = (await readRow(id, owner))!;
    }
    const recovery = row.status === 'failed' && row.provider_response_id && row.error?.startsWith('The recommendation contains');
    if (active.includes(row.status) || recovery) {
      if (!env.OPENAI_API_KEY) throw Error('The secure AI connection is not configured.');
      await advance(row);
      row = (await readRow(id, owner))!;
    }
    return privateJson(await view(row));
  } catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    const owner = await identity(req, true);
    if (!env.OPENAI_API_KEY) throw Error('The secure AI connection is not configured.');
    const body = await req.json() as Record<string, unknown>;
    if (body.action === 'recover' || body.action === 'repair') {
      const row = await readRow(String(body.id), owner);
      if (!row) return failure(Error('Recommendation not found.'), 404);
      if (active.includes(row.status)) return privateJson(await view(row));
      if (body.action === 'recover') {
        // Reprocess only an existing provider response, never submit a paid stage.
        const list = await attempts(row.id);
        if (list.some(a => a.phase !== 'legacy')) return privateJson(await view(row));
        await advance(row);
        return privateJson(await view((await readRow(row.id, owner))!));
      }
      if (!['needs_evidence', 'needs_attention', 'failed'].includes(row.status)) throw Error('This comparison does not need repair.');
      if (body.confirmPaidRepair !== true) throw Error('Confirm the displayed repair cost first.');
      const list = await attempts(row.id);
      if (!list.length && row.provider_response_id) {
        await advance(row);
        return privateJson(await view((await readRow(row.id, owner))!));
      }
      if (list.reduce((s, a) => s + a.reserved_usd, 0) + CYCLE_RESERVE > BUDGET_USD) throw Error('Repair would exceed the original $1 budget. Saved research is preserved.');
      const cycle = Math.max(-1, ...list.map(a => a.cycle)) + 1;
      const gaps = row.result ? (JSON.parse(row.result) as MonthlyPicksResearch).evidenceIssues ?? [] : [row.error ?? 'Complete missing research.'];
      const attemptId = `${row.id}:${cycle}:research`;
      // Reserve and claim in one statement. Crash recovery sees the pending attempt.
      const claim = await db().prepare(`INSERT OR IGNORE INTO recommendation_attempts
        (id,recommendation_id,phase,cycle,state,request,reserved_usd,created_at)
        SELECT ?,?,'research',?,'pending',?,?,? WHERE
        EXISTS (SELECT 1 FROM monthly_recommendations WHERE id=? AND user_id=? AND status IN ('needs_evidence','needs_attention','failed'))
        AND NOT EXISTS (SELECT 1 FROM monthly_recommendations WHERE user_id=? AND id<>? AND status IN ('queued','in_progress'))
        AND NOT EXISTS (SELECT 1 FROM recommendation_attempts WHERE recommendation_id=? AND state IN ('pending','submitting','in_progress'))
        AND COALESCE((SELECT SUM(reserved_usd) FROM recommendation_attempts WHERE recommendation_id=?),0)+?<=?`)
        .bind(attemptId, row.id, cycle, JSON.stringify(researchRequest(savedSnapshot(row, list), gaps)), RESEARCH_RESERVE, now(),
          row.id, owner, owner, row.id, row.id, row.id, CYCLE_RESERVE, BUDGET_USD).run();
      if (!claim.meta.changes) return privateJson(await view((await readRow(row.id, owner))!));
      await setState(row, 'in_progress');
      const a = (await db().prepare('SELECT * FROM recommendation_attempts WHERE id=?').bind(attemptId).first<Attempt>())!;
      await submit(row, a);
      return privateJson(await view((await readRow(row.id, owner))!));
    }
    const month = typeof body.month === 'string' ? body.month : '';
    const amount = Number(body.amount), fee = Number(body.feePct ?? 0);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Choose a valid month.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw Error('Enter a valid investment amount.');
    if (!Number.isFinite(fee) || fee < 0 || fee > 10) throw Error('Fee estimate must be between 0% and 10%.');
    if (!Array.isArray(body.shortlist) || body.shortlist.some(t => typeof t !== 'string')) throw Error('Choose 1–15 companies.');
    const shortlist = [...new Set((body.shortlist as string[]).map(t => t.trim().toUpperCase()))].sort();
    if (!shortlist.length || shortlist.length > 15) throw Error('Choose 1–15 companies.');
    const p = await db().prepare('SELECT payload FROM portfolios WHERE user_id=?').bind(owner).first<{ payload: string }>();
    const portfolio: Portfolio = p ? JSON.parse(p.payload) : blankPortfolio();
    if (shortlist.some(t => !portfolio.companies.some(c => c.ticker === t))) throw Error('Unknown shortlisted company.');
    const previous = (await db().prepare('SELECT * FROM monthly_recommendations WHERE user_id=? AND month=? AND amount=? AND fee_pct=? ORDER BY created_at DESC').bind(owner, month, amount, fee).all<Row>()).results;
    const existing = previous.find(r => JSON.stringify((JSON.parse(r.shortlist) as string[]).sort()) === JSON.stringify(shortlist));
    if (existing && body.rerun !== true) return privateJson(await view(existing));
    const id = crypto.randomUUID(), timestamp = now();
    const saved = await db().prepare(`INSERT INTO monthly_recommendations (id,user_id,month,amount,fee_pct,shortlist,status,model,created_at,updated_at)
      SELECT ?,?,?,?,?,?,'queued',?,?,? WHERE NOT EXISTS (SELECT 1 FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','in_progress'))`)
      .bind(id, owner, month, amount, fee, JSON.stringify(shortlist), MODEL, timestamp, timestamp, owner).run();
    if (!saved.meta.changes) {
      const running = await db().prepare("SELECT * FROM monthly_recommendations WHERE user_id=? AND status IN ('queued','in_progress') LIMIT 1").bind(owner).first<Row>();
      if (!running) throw Error('Another research request is starting.');
      return privateJson(await view(running));
    }
    const row = (await readRow(id, owner))!;
    const a = await createAttempt(row, 'research', 0, researchRequest(snapshot(row, portfolio.companies)), RESEARCH_RESERVE);
    await submit(row, a);
    return privateJson(await view((await readRow(id, owner))!));
  } catch (e) { return failure(e); }
}
