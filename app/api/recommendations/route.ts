import { env } from 'cloudflare:workers';
import { blankPortfolio, type Portfolio } from '@/lib/portfolio';
import type { MonthlyPicksResearch } from '@/lib/monthly-picks';
import { db, failure, identity } from '@/lib/server';
import {
  WORKFLOW_VERSION, MODEL, BUDGET_USD, RESEARCH_RESERVE, REPAIR_RESERVE, FORMAT_RESERVE,
  researchRequest, repairRequest, comparisonRequest, makeBatches, parseCompanyEvidence,
  resolveComparison, outputText, usage, type ProviderResponse,
} from '@/lib/recommendation-evidence';

type Row = {
  id: string; user_id: string; month: string; amount: number; fee_pct: number; shortlist: string;
  status: string; provider_response_id: string | null; result: string | null; sources: string | null;
  error: string | null; model: string; estimated_cost_usd: number | null; workflow_version: number;
  snapshot: string | null; created_at: string; updated_at: string;
};
type Attempt = {
  id: string; recommendation_id: string; phase: 'research' | 'repair' | 'comparison' | 'legacy';
  cycle: number; batch_key: string; state: string; provider_response_id: string | null;
  request: string; response: string | null; reserved_usd: number; cost_usd: number | null;
  error: string | null; created_at: string;
};
type Snapshot = {
  generatedOn: string; outlookDays: '60-90'; contributionMonth: string; freshMoneyPkr: number;
  shortlist: string[]; companies: { ticker: string; name: string }[];
  quotes: Record<string, { price: number; date: string; asOf: string; source: string }>;
};

const now = () => new Date().toISOString();
const active = ['queued', 'in_progress'];
const privateJson = (body: unknown) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
const readRow = (id: string, owner: string) => db().prepare('SELECT * FROM monthly_recommendations WHERE id=? AND user_id=?').bind(id, owner).first<Row>();
async function attempts(id: string) {
  return (await db().prepare('SELECT * FROM recommendation_attempts WHERE recommendation_id=? ORDER BY cycle,created_at,id').bind(id).all<Attempt>()).results;
}
function publicRow(row: Row) {
  return {
    id: row.id, month: row.month, amount: row.amount, feePct: row.fee_pct,
    shortlist: JSON.parse(row.shortlist), status: row.status,
    result: row.result ? JSON.parse(row.result) : null,
    sources: row.sources ? JSON.parse(row.sources) : [], error: row.error, model: row.model,
    workflowVersion: row.workflow_version, estimatedCostUsd: row.estimated_cost_usd,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function createSnapshot(row: Pick<Row, 'month' | 'amount' | 'created_at'>, tickers: string[], portfolio?: Portfolio): Snapshot {
  return {
    generatedOn: row.created_at.slice(0, 10), outlookDays: '60-90', contributionMonth: row.month,
    freshMoneyPkr: row.amount, shortlist: [...tickers],
    companies: tickers.map(ticker => ({ ticker, name: portfolio?.companies.find(company => company.ticker === ticker)?.name ?? ticker })),
    quotes: Object.fromEntries(tickers.flatMap(ticker => {
      const quote = portfolio?.quotes?.[ticker];
      return quote && Number.isFinite(quote.price) && quote.price > 0
        ? [[ticker, { price: quote.price, date: quote.date, asOf: quote.asOf, source: quote.source }]]
        : [];
    })),
  };
}
function savedSnapshot(row: Row): Snapshot {
  const snapshot = row.snapshot ? JSON.parse(row.snapshot) as Snapshot : createSnapshot(row, JSON.parse(row.shortlist));
  snapshot.quotes ??= {};
  return snapshot;
}
function quoteSources(snapshot: Snapshot) {
  return Object.entries(snapshot.quotes).flatMap(([ticker, quote]) => {
    try {
      const url = new URL(quote.source);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      return [{ url: quote.source, title: `${ticker} dated market quote`, sourceType: 'primary' as const }];
    } catch { return []; }
  });
}
function researchResponses(rows: Attempt[]) {
  return rows.filter(attempt => attempt.response && ['research', 'repair'].includes(attempt.phase))
    .map(attempt => JSON.parse(attempt.response!) as ProviderResponse);
}
function committed(rows: Attempt[]) {
  return rows.reduce((sum, attempt) => sum + (attempt.cost_usd ?? attempt.reserved_usd), 0);
}
async function setState(row: Row, status: string, error: string | null = null) {
  await db().prepare('UPDATE monthly_recommendations SET status=?,error=?,updated_at=? WHERE id=? AND user_id=?')
    .bind(status, error, now(), row.id, row.user_id).run();
}
async function createAttempt(
  row: Row,
  phase: Attempt['phase'],
  cycle: number,
  batchKey: string,
  request: unknown,
  reserve: number,
  required = true,
) {
  const id = `${row.id}:${cycle}:${phase}:${batchKey}`;
  await db().prepare(`INSERT OR IGNORE INTO recommendation_attempts
    (id,recommendation_id,phase,cycle,batch_key,state,request,reserved_usd,created_at)
    SELECT ?,?,?,?,?,'pending',?,?,? WHERE
    COALESCE((SELECT SUM(CASE WHEN cost_usd IS NULL THEN reserved_usd ELSE cost_usd END)
      FROM recommendation_attempts WHERE recommendation_id=?),0)+?<=?`)
    .bind(id, row.id, phase, cycle, batchKey, JSON.stringify(request), reserve, now(), row.id, reserve, BUDGET_USD).run();
  const attempt = await db().prepare('SELECT * FROM recommendation_attempts WHERE id=?').bind(id).first<Attempt>();
  if (!attempt && required) throw Error('The $1 research budget cannot safely reserve this workflow.');
  return attempt ?? null;
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
    const message = `Submission could not be confirmed. No automatic paid retry. ${error instanceof Error ? error.message : ''}`.slice(0, 1000);
    await db().prepare("UPDATE recommendation_attempts SET state='uncertain',error=? WHERE id=?").bind(message, attempt.id).run();
    await setState(row, 'needs_attention', message);
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
async function retrieve(row: Row, attempt: Attempt) {
  if (!attempt.provider_response_id) throw Error('Provider response ID is missing.');
  const response = await fetch(`https://api.openai.com/v1/responses/${encodeURIComponent(attempt.provider_response_id)}?include%5B%5D=web_search_call.action.sources`, {
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw Error(`Could not retrieve saved research (${response.status}). No new research was started.`);
  const result = await response.json() as ProviderResponse;
  if (active.includes(result.status ?? '')) return false;
  await archive(row, attempt, result);
  if (result.status !== 'completed') {
    await setState(row, 'needs_attention', result.error?.message ?? `Provider stopped: ${result.incomplete_details?.reason ?? result.status}. Saved output is retained.`);
  }
  return result.status === 'completed';
}
async function saveComparison(row: Row, result: MonthlyPicksResearch, sources: unknown) {
  const assessed = result.assessedCount ?? result.coverage.filter(company => company.assessmentStatus === 'assessed').length;
  const status = assessed === 0 ? 'needs_evidence' : result.evidenceIssues?.length ? 'completed_partial' : 'completed';
  const error = status === 'needs_evidence'
    ? 'No company had enough claim-level evidence for an actionable comparison.'
    : status === 'completed_partial'
      ? `Recommendation uses ${assessed} sufficiently researched companies; unassessed candidates are listed separately.`
      : null;
  await db().prepare('UPDATE monthly_recommendations SET status=?,result=?,sources=?,error=?,updated_at=? WHERE id=? AND user_id=?')
    .bind(status, JSON.stringify(result), JSON.stringify(sources), error, now(), row.id, row.user_id).run();
}
async function initializeV2(row: Row, snapshot: Snapshot) {
  // Reserve the final comparison first, then every deterministic research batch.
  await createAttempt(row, 'comparison', 0, 'final', {}, FORMAT_RESERVE);
  const batches = makeBatches(snapshot.companies);
  for (let index = 0; index < batches.length; index++) {
    await createAttempt(row, 'research', 0, `batch-${index + 1}`, researchRequest({ ...snapshot, companies: batches[index] }), RESEARCH_RESERVE);
  }
  const list = await attempts(row.id);
  const first = list.find(attempt => attempt.phase === 'research' && attempt.state === 'pending');
  if (!first) throw Error('Research batch was not created.');
  await submit(row, first);
}
function noEvidenceResult(snapshot: Snapshot, evidence: ReturnType<typeof parseCompanyEvidence>['evidence']): MonthlyPicksResearch {
  return {
    marketOutlook: 'No recommendation is ready because no shortlisted company has complete claim-level evidence.',
    picks: [], unallocatedPct: 100, assessedCount: 0, totalCount: snapshot.shortlist.length,
    evidenceIssues: evidence.map(company => ({ ticker: company.ticker, kind: 'material_gap' as const, message: company.evidenceGap })),
    coverage: evidence.map(company => ({
      ticker: company.ticker, outlook: 'Insufficient evidence' as const, summary: company.summary || company.evidenceGap,
      sourceUrls: company.claims.map(claim => claim.sourceUrl),
      sourceDetails: company.claims.map(claim => ({
        url: claim.sourceUrl,
        title: new URL(claim.sourceUrl).hostname,
        date: claim.sourceDate,
        sourceType: /(^|\.)psx\.com\.pk$/i.test(new URL(claim.sourceUrl).hostname) ? 'primary' : 'other',
      })),
      assessmentStatus: 'unassessed' as const, evidenceStatus: 'needs_repair' as const, evidenceGap: company.evidenceGap,
    })),
  };
}
async function advanceV2(row: Row) {
  let list = await attempts(row.id);
  const uncertain = list.find(attempt => ['uncertain', 'failed'].includes(attempt.state));
  if (uncertain) {
    await setState(row, 'needs_attention', uncertain.error ?? 'A provider stage did not finish. Saved evidence is retained.');
    return;
  }
  const submitting = list.find(attempt => attempt.state === 'submitting');
  if (submitting) {
    if (Date.now() - Date.parse(submitting.created_at) > 120000) await setState(row, 'needs_attention', 'Submission status is uncertain. Its budget reservation is retained.');
    return;
  }
  const running = list.find(attempt => attempt.state === 'in_progress');
  if (running) {
    if (!await retrieve(row, running)) return;
    list = await attempts(row.id);
  }
  const pendingResearch = list.find(attempt => ['research', 'repair'].includes(attempt.phase) && attempt.state === 'pending');
  if (pendingResearch) { await submit(row, pendingResearch); return; }

  const snapshot = savedSnapshot(row);
  const parsed = parseCompanyEvidence(researchResponses(list), snapshot.shortlist, snapshot.generatedOn, quoteSources(snapshot));
  const repair = list.find(attempt => attempt.phase === 'repair');
  if (parsed.issues.length && !repair) {
    const candidate = await createAttempt(row, 'repair', 0, 'auto', repairRequest(snapshot, parsed.evidence, parsed.issues), REPAIR_RESERVE, false);
    if (candidate) { await submit(row, candidate); return; }
  }
  if (!parsed.evidence.some(company => company.assessmentStatus === 'assessed')) {
    const comparison = list.find(attempt => attempt.phase === 'comparison' && attempt.state === 'pending');
    if (comparison) await db().prepare("UPDATE recommendation_attempts SET state='skipped',cost_usd=0 WHERE id=? AND state='pending'").bind(comparison.id).run();
    await saveComparison(row, noEvidenceResult(snapshot, parsed.evidence), parsed.sources);
    return;
  }
  const comparison = list.find(attempt => attempt.phase === 'comparison');
  if (!comparison) throw Error('Final comparison reservation is missing.');
  if (comparison.state === 'pending') {
    const request = comparisonRequest(snapshot, parsed.evidence, parsed.sources, snapshot.shortlist);
    await db().prepare('UPDATE recommendation_attempts SET request=? WHERE id=? AND state=\'pending\'').bind(JSON.stringify(request), comparison.id).run();
    await submit(row, { ...comparison, request: JSON.stringify(request) });
    return;
  }
  if (comparison.state !== 'completed' || !comparison.response) return;
  try {
    const result = resolveComparison(JSON.parse(outputText(JSON.parse(comparison.response) as ProviderResponse)), snapshot.shortlist, parsed.sources, parsed.evidence);
    await saveComparison(row, result, parsed.sources);
  } catch (error) {
    await setState(row, 'needs_attention', `Research is preserved; the comparison needs formatting repair. ${error instanceof Error ? error.message : ''}`);
  }
}
async function view(row: Row) {
  const list = await attempts(row.id);
  const research = list.filter(attempt => ['research', 'repair'].includes(attempt.phase));
  const completed = research.filter(attempt => attempt.state === 'completed').length;
  const unresolved = ['failed', 'needs_evidence', 'needs_attention'].includes(row.status);
  const recoverableRepair = row.workflow_version >= WORKFLOW_VERSION && row.status === 'needs_attention' &&
    list.some(attempt => attempt.phase === 'repair' && attempt.state === 'failed') &&
    row.error?.includes('max_output_tokens') === true && committed(list) + REPAIR_RESERVE <= BUDGET_USD;
  return {
    ...publicRow(row),
    phase: list.find(attempt => attempt.state === 'in_progress')?.phase ?? list.at(-1)?.phase ?? 'research',
    batchProgress: { completed, total: research.length },
    budgetCommittedUsd: committed(list),
    canRecover: false,
    canRepair: recoverableRepair,
    repairMaxCostUsd: recoverableRepair ? REPAIR_RESERVE : undefined,
    researchNotes: unresolved ? researchResponses(list).map(outputText).join('\n\n') : undefined,
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
      await setState(row, 'needs_attention', 'This run started under the earlier workflow. Its saved data is preserved; start a fresh run for claim-level evidence.');
      row = (await readRow(id, owner))!;
    } else if (active.includes(row.status) && row.workflow_version >= WORKFLOW_VERSION) {
      if (!env.OPENAI_API_KEY) throw Error('The secure AI connection is not configured.');
      await advanceV2(row);
      row = (await readRow(id, owner))!;
    }
    return privateJson(await view(row));
  } catch (error) { return failure(error); }
}

export async function POST(req: Request) {
  try {
    const owner = await identity(req, true);
    if (!env.OPENAI_API_KEY) throw Error('The secure AI connection is not configured.');
    const body = await req.json() as Record<string, unknown>;
    if (body.action === 'recover' || body.action === 'repair') {
      const row = await readRow(String(body.id), owner);
      if (!row) return failure(Error('Recommendation not found.'), 404);
      if (row.workflow_version < WORKFLOW_VERSION) throw Error('This saved recommendation uses the earlier workflow. Start a fresh run to use claim-level evidence.');
      if (body.action !== 'repair' || body.confirmPaidRepair !== true) return privateJson(await view(row));
      const list = await attempts(row.id);
      const failedRepair = list.find(attempt => attempt.phase === 'repair' && attempt.state === 'failed');
      if (row.status !== 'needs_attention' || !failedRepair || !row.error?.includes('max_output_tokens')) throw Error('This run does not have a recoverable repair stage.');
      const snapshot = savedSnapshot(row);
      const parsed = parseCompanyEvidence(researchResponses(list), snapshot.shortlist, snapshot.generatedOn, quoteSources(snapshot));
      if (committed(list) + REPAIR_RESERVE > BUDGET_USD) throw Error('Repair would exceed the original $1 budget.');
      await db().prepare("UPDATE recommendation_attempts SET state='superseded' WHERE id=? AND state='failed'").bind(failedRepair.id).run();
      const next = await createAttempt(row, 'repair', failedRepair.cycle + 1, 'recovery', repairRequest(snapshot, parsed.evidence, parsed.issues), REPAIR_RESERVE);
      await setState(row, 'in_progress');
      await submit(row, next!);
      return privateJson(await view((await readRow(row.id, owner))!));
    }
    const month = typeof body.month === 'string' ? body.month : '';
    const amount = Number(body.amount), fee = Number(body.feePct ?? 0);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error('Choose a valid month.');
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) throw Error('Enter a valid investment amount.');
    if (!Number.isFinite(fee) || fee < 0 || fee > 10) throw Error('Fee estimate must be between 0% and 10%.');
    if (!Array.isArray(body.shortlist) || body.shortlist.some(ticker => typeof ticker !== 'string')) throw Error('Choose 1–15 companies.');
    const shortlist = [...new Set((body.shortlist as string[]).map(ticker => ticker.trim().toUpperCase()))].sort();
    if (!shortlist.length || shortlist.length > 15) throw Error('Choose 1–15 companies.');
    const savedPortfolio = await db().prepare('SELECT payload FROM portfolios WHERE user_id=?').bind(owner).first<{ payload: string }>();
    const portfolio: Portfolio = savedPortfolio ? JSON.parse(savedPortfolio.payload) : blankPortfolio();
    if (shortlist.some(ticker => !portfolio.companies.some(company => company.ticker === ticker))) throw Error('Unknown shortlisted company.');
    const previous = (await db().prepare('SELECT * FROM monthly_recommendations WHERE user_id=? AND month=? AND amount=? AND fee_pct=? ORDER BY created_at DESC').bind(owner, month, amount, fee).all<Row>()).results;
    const existing = previous.find(row => row.workflow_version === WORKFLOW_VERSION && JSON.stringify((JSON.parse(row.shortlist) as string[]).sort()) === JSON.stringify(shortlist));
    if (existing && body.rerun !== true) return privateJson(await view(existing));
    const id = crypto.randomUUID(), timestamp = now();
    const snapshot = createSnapshot({ month, amount, created_at: timestamp }, shortlist, portfolio);
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
    await initializeV2(row, snapshot);
    return privateJson(await view((await readRow(id, owner))!));
  } catch (error) { return failure(error); }
}
