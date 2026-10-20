// Operational health for the admin console: freshness of every public data pipeline, queued requests, AI spend. Counts,
// timestamps and sanitised error text only; the server holds no private portfolio data.
import { platformReport, type PlatformOptions } from './admin-platform.ts';
import { dataHealth, type DataHealth } from './data-health.ts';
import { PIPELINES, pipelineStatus, type PipelineAction, type PipelineStatus } from './pipelines.ts';

export type PipelineRow = {
  id: string; label: string; expected: string; status: PipelineStatus;
  lastSuccessAt: string | null; ageMinutes: number | null; lastError: string | null;
  action: PipelineAction | null; workflow: string | null;
  lastRun: { at: string; ok: boolean; source: string; detail: string | null } | null;
};
export type QueueItem = { kind: string; ticker: string; status: string; requestedAt: string; attempts: number; error: string | null };
export type Queues = { counts: { kind: string; status: string; n: number }[]; stuck: QueueItem[]; stuckCount: number; aiQueued: number };
export type AiSource = { id: 'research-desk' | 'ai-lab' | 'face-value'; label: string; usd: number; capUsd: number | null };
/** The face-value finder's own numbers: what each lookup costs and what it found. */
export type FaceValueSpend = { runs: number; lookups: number; found: number; usd: number; avgUsd: number | null; allTimeUsd: number };
/** One AI workflow's cost: this month, all time, how many runs it made and when it last ran. */
export type WorkflowCost = { id: string; label: string; monthUsd: number; allTimeUsd: number; runs: number; lastAt: string | null };
export type AiSpend = {
  month: string; sources: AiSource[]; totalUsd: number; faceValue: FaceValueSpend; workflows: WorkflowCost[];
  months: { month: string; usd: number }[];
  recentRuns: { startedAt: string; status: string; models: string; costUsd: number; error: string | null }[];
};
export type CronBeat = { lastBeatAt: string | null; status: PipelineStatus };
export type PlatformPill = { status: PipelineStatus; headline: string };
export type AdminHealth = DataHealth & { pipelines: PipelineRow[]; queues: Queues; aiSpend: AiSpend; cron: CronBeat; platform: PlatformPill };

export type AdminHealthOptions = { now?: Date; aiLabCapUsd?: number | null; platform?: PlatformOptions };

const STUCK_MINUTES = 15;
const cut = (text: string | null) => (text ? text.slice(0, 300) : null);

// Latest success per pipeline, and the latest recorded failure where one exists.
const SUCCESS: Record<string, string> = {
  quotes: 'SELECT MAX(fetched_at) AS t FROM quote_refreshes',
  history: 'SELECT MAX(MAX(COALESCE(intraday_fetched_at,\'\')), MAX(COALESCE(eod_fetched_at,\'\'))) AS t FROM price_history',
  facts: 'SELECT MAX(fetched_at) AS t FROM company_facts',
  dividends: 'SELECT MAX(fetched_at) AS t FROM dividend_announcements',
  directory: "SELECT MAX(last_success_at) AS t FROM refresh_state WHERE kind='directory'",
  'face-values': "SELECT MAX(last_success_at) AS t FROM refresh_state WHERE kind='face-value'",
  metals: 'SELECT MAX(fetched_at) AS t FROM metal_rates',
  funds: 'SELECT MAX(fetched_at) AS t FROM fund_navs',
  'ai-research': "SELECT MAX(started_at) AS t FROM ai_research_runs WHERE status IN ('completed','capped') AND models NOT LIKE 'face-value:%'",
};
const FAILURE: Record<string, string> = {
  quotes: "SELECT last_error AS e, last_attempt_at AS at FROM refresh_state WHERE kind LIKE 'quote%' AND last_error IS NOT NULL ORDER BY last_attempt_at DESC LIMIT 1",
  facts: 'SELECT error AS e, attempted_at AS at FROM facts_requests WHERE error IS NOT NULL ORDER BY attempted_at DESC LIMIT 1',
  directory: "SELECT last_error AS e, last_attempt_at AS at FROM refresh_state WHERE kind='directory' AND last_error IS NOT NULL ORDER BY last_attempt_at DESC LIMIT 1",
  'face-values': "SELECT last_error AS e, last_attempt_at AS at FROM refresh_state WHERE kind='face-value' AND last_error IS NOT NULL ORDER BY last_attempt_at DESC LIMIT 1",
  'ai-research': "SELECT error AS e, finished_at AS at FROM ai_research_runs WHERE status='failed' AND models NOT LIKE 'face-value:%' ORDER BY started_at DESC LIMIT 1",
};

async function first<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T | null> {
  try { return await db.prepare(sql).bind(...args).first<T>(); } catch { return null; }
}
async function rows<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T[]> {
  try { return (await db.prepare(sql).bind(...args).all<T>()).results; } catch { return []; }
}

export async function pipelineRows(db: D1Database, now: Date, marketOpen: boolean): Promise<PipelineRow[]> {
  return Promise.all(PIPELINES.map(async (def) => {
    const data = (await first<{ t: string | null }>(db, SUCCESS[def.id]))?.t || null;
    // A clean recorded run also proves the job is alive (it may rightly have had nothing new to store).
    const lastOk = await first<{ t: string | null }>(db, 'SELECT MAX(finished_at) AS t FROM job_runs WHERE job=? AND ok=1', def.id);
    const success = [data, lastOk?.t ?? null].filter((t): t is string => !!t).sort((a, b) => a.localeCompare(b)).pop() ?? null;
    const own = FAILURE[def.id] ? await first<{ e: string | null; at: string | null }>(db, FAILURE[def.id]) : null;
    const run = await first<{ finished_at: string; ok: number; source: string; detail: string | null }>(
      db, 'SELECT finished_at,ok,source,detail FROM job_runs WHERE job=? ORDER BY started_at DESC, id DESC LIMIT 1', def.id);
    const ran = run && run.ok === 0 ? { e: run.detail ?? 'The last run failed.', at: run.finished_at } : null;
    const failure = [own, ran].filter((f): f is { e: string | null; at: string | null } => !!f?.e).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')).pop() ?? null;
    // A failure only counts while it is newer than the last success.
    const live = failure?.e && (!success || !failure.at || failure.at > success) ? failure : null;
    const verdict = pipelineStatus(def, success, live ? { at: live.at } : null, now, marketOpen);
    return {
      id: def.id, label: def.label, expected: def.expected, status: verdict.status, lastSuccessAt: success,
      ageMinutes: verdict.ageMinutes, lastError: live ? cut(live.e) : null, action: def.action, workflow: def.workflow,
      lastRun: run ? { at: run.finished_at, ok: run.ok === 1, source: run.source, detail: cut(run.detail) } : null,
    };
  }));
}

/** The cron Worker writes a heartbeat row on every firing (the single Cron Trigger fires every 5 minutes, every day). */
export async function cronBeat(db: D1Database, now: Date): Promise<CronBeat> {
  const beat = (await first<{ t: string | null }>(db, "SELECT last_success_at AS t FROM refresh_state WHERE kind='cron' AND key='heartbeat'"))?.t ?? null;
  const def = { id: 'cron', label: 'Cron Worker', expected: '', cadence: 'daily' as const, lateHours: 30, failHours: 80, required: false, workflow: null, action: null };
  return { lastBeatAt: beat, status: pipelineStatus(def, beat, null, now, false).status };
}

export async function queueSummary(db: D1Database, now: Date): Promise<Queues> {
  const counts = await rows<{ kind: string; status: string; n: number }>(db, 'SELECT kind, status, COUNT(*) AS n FROM refresh_requests GROUP BY kind, status ORDER BY kind, status');
  const cutoff = new Date(now.getTime() - STUCK_MINUTES * 60_000).toISOString();
  const open = "status IN ('queued','running') AND requested_at<?";
  const stuck = await rows<{ kind: string; ticker: string; status: string; requested_at: string; attempts: number; error: string | null }>(
    db, `SELECT kind,ticker,status,requested_at,attempts,error FROM refresh_requests WHERE ${open} ORDER BY requested_at LIMIT 10`, cutoff);
  const stuckCount = (await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM refresh_requests WHERE ${open}`, cutoff))?.n ?? 0;
  const aiQueued = (await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM ai_research_requests WHERE status='queued'"))?.n ?? 0;
  return {
    counts, stuckCount, aiQueued,
    stuck: stuck.map((r) => ({ kind: r.kind, ticker: r.ticker, status: r.status, requestedAt: r.requested_at, attempts: r.attempts, error: cut(r.error) })),
  };
}

export async function aiSpend(db: D1Database, now: Date, opts: AdminHealthOptions): Promise<AiSpend> {
  const month = now.toISOString().slice(0, 7);
  const start = `${month}-01T00:00:00.000Z`;
  const desk = (await first<{ s: number }>(db, "SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_usage WHERE created_at>=?", start))?.s ?? 0;
  const lab = (await first<{ s: number }>(db, "SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_research_runs WHERE started_at>=? AND models NOT LIKE 'face-value:%'", start))?.s ?? 0;
  const face = (await first<{ s: number }>(db, "SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_research_runs WHERE started_at>=? AND models LIKE 'face-value:%'", start))?.s ?? 0;
  const faceRuns = await rows<{ stats: string | null }>(db, "SELECT stats FROM ai_research_runs WHERE started_at>=? AND models LIKE 'face-value:%'", start);
  let lookups = 0, found = 0;
  for (const r of faceRuns) {
    try {
      for (const t of (JSON.parse(r.stats ?? '{}') as { perTicker?: { skipped?: string; stored?: number }[] }).perTicker ?? []) {
        if (!t.skipped) lookups++;
        found += t.stored ?? 0;
      }
    } catch { /* a run without stats */ }
  }
  const faceAll = (await first<{ s: number }>(db, "SELECT COALESCE(SUM(cost_usd),0) AS s FROM ai_research_runs WHERE models LIKE 'face-value:%'"))?.s ?? 0;
  const faceValue: FaceValueSpend = { runs: faceRuns.length, lookups, found, usd: face, avgUsd: lookups ? face / lookups : null, allTimeUsd: faceAll };
  const deskRows = await rows<{ source: string; month: number; total: number; calls: number; last: string | null }>(
    db, 'SELECT source, SUM(CASE WHEN created_at>=? THEN cost_usd ELSE 0 END) AS month, SUM(cost_usd) AS total, SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) AS calls, MAX(created_at) AS last FROM ai_usage GROUP BY source', start, start);
  const runRows = await rows<{ face: number; month: number; total: number; runs: number; last: string | null }>(
    db, "SELECT models LIKE 'face-value:%' AS face, SUM(CASE WHEN started_at>=? THEN cost_usd ELSE 0 END) AS month, SUM(cost_usd) AS total, SUM(CASE WHEN started_at>=? THEN 1 ELSE 0 END) AS runs, MAX(started_at) AS last FROM ai_research_runs GROUP BY face", start, start);
  const runRow = (face: boolean) => runRows.find((r) => !!r.face === face);
  const workflows: WorkflowCost[] = [
    ...deskRows.map((r) => ({ id: `research-desk:${r.source}`, label: `Research desk (${r.source})`, monthUsd: r.month, allTimeUsd: r.total, runs: r.calls, lastAt: r.last })),
    { id: 'ai-lab', label: 'AI Lab research', monthUsd: runRow(false)?.month ?? 0, allTimeUsd: runRow(false)?.total ?? 0, runs: runRow(false)?.runs ?? 0, lastAt: runRow(false)?.last ?? null },
    { id: 'face-value', label: 'Face-value finder', monthUsd: runRow(true)?.month ?? 0, allTimeUsd: runRow(true)?.total ?? 0, runs: runRow(true)?.runs ?? 0, lastAt: runRow(true)?.last ?? null },
  ];
  const sources: AiSource[] = [
    { id: 'research-desk', label: 'Research desk', usd: desk, capUsd: null },
    { id: 'ai-lab', label: 'AI Lab research', usd: lab, capUsd: opts.aiLabCapUsd ?? null },
    { id: 'face-value', label: 'Face-value finder', usd: face, capUsd: null },
  ];
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)).toISOString();
  const byMonth = new Map<string, number>();
  for (const r of await rows<{ m: string; s: number }>(db, 'SELECT substr(created_at,1,7) AS m, SUM(cost_usd) AS s FROM ai_usage WHERE created_at>=? GROUP BY m', since)) byMonth.set(r.m, (byMonth.get(r.m) ?? 0) + r.s);
  for (const r of await rows<{ m: string; s: number }>(db, 'SELECT substr(started_at,1,7) AS m, SUM(cost_usd) AS s FROM ai_research_runs WHERE started_at>=? GROUP BY m', since)) byMonth.set(r.m, (byMonth.get(r.m) ?? 0) + r.s);
  const months = Array.from({ length: 6 }, (_, i) => {
    const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - i), 1)).toISOString().slice(0, 7);
    return { month: m, usd: byMonth.get(m) ?? 0 };
  });
  const recent = await rows<{ started_at: string; status: string; models: string; cost_usd: number; error: string | null }>(
    db, 'SELECT started_at,status,models,cost_usd,error FROM ai_research_runs ORDER BY started_at DESC LIMIT 10');
  return {
    month, sources, totalUsd: desk + lab + face, faceValue, workflows, months,
    recentRuns: recent.map((r) => ({ startedAt: r.started_at, status: r.status, models: r.models, costUsd: r.cost_usd, error: cut(r.error) })),
  };
}

export async function adminHealth(db: D1Database, opts: AdminHealthOptions = {}): Promise<AdminHealth> {
  const now = opts.now ?? new Date();
  const base = await dataHealth(db, now);
  const [pipelines, queues, spend, cron, plat] = await Promise.all([pipelineRows(db, now, base.marketOpen), queueSummary(db, now), aiSpend(db, now, opts), cronBeat(db, now), platformReport(db, { ...opts.platform, now })]);
  return { ...base, pipelines, queues, aiSpend: spend, cron, platform: { status: plat.status, headline: plat.headline } };
}

/** Caps from Worker settings: only the AI Lab can have one (none unless set); the other AI workflows have none. */
export function spendCaps(env: { AI_RESEARCH_MONTHLY_CAP_USD?: string }): AdminHealthOptions {
  const lab = Number(env.AI_RESEARCH_MONTHLY_CAP_USD);
  return { aiLabCapUsd: Number.isFinite(lab) && lab > 0 ? lab : null };
}
