// Run history of the public data jobs. Written by the GitHub scrapers (through scripts/d1-rest.mjs) and the cron Worker,
// read by the admin console. Public data only: job name, outcome, a short message.
export type JobRun = { id: number; job: string; source: string; startedAt: string; finishedAt: string; ok: boolean; detail: string | null };

export const JOB_RUN_RETENTION_DAYS = 90;
const DETAIL_LIMIT = 300;

/** Keeps a message short and free of anything that looks like a credential or a URL query string. */
export function cleanDetail(text: unknown): string | null {
  if (text == null) return null;
  const raw = text instanceof Error ? text.message : typeof text === 'string' ? text : JSON.stringify(text);
  const cleaned = raw
    .replace(/(bearer|token|key|secret|authorization)[=:\s]+[A-Za-z0-9._~+/-]{8,}/gi, '$1 [hidden]')
    .replace(/\?[^\s"']{8,}/g, '?…')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, DETAIL_LIMIT) : null;
}

type Db = Pick<D1Database, 'prepare'>;

export async function recordJobRun(
  db: Db,
  run: { job: string; source: 'github' | 'cron' | 'admin'; startedAt: string; ok: boolean; detail?: unknown; finishedAt?: string },
): Promise<void> {
  await db.prepare('INSERT INTO job_runs (job,source,started_at,finished_at,ok,detail) VALUES (?,?,?,?,?,?)')
    .bind(run.job, run.source, run.startedAt, run.finishedAt ?? new Date().toISOString(), run.ok ? 1 : 0, cleanDetail(run.detail)).run();
}

export async function recentJobRuns(db: D1Database, job?: string, limit = 30): Promise<JobRun[]> {
  const n = Math.max(1, Math.min(100, Math.trunc(limit)));
  const sql = `SELECT id,job,source,started_at,finished_at,ok,detail FROM job_runs ${job ? 'WHERE job=?' : ''} ORDER BY started_at DESC, id DESC LIMIT ${n}`;
  const stmt = db.prepare(sql);
  const rows = (await (job ? stmt.bind(job) : stmt).all<{ id: number; job: string; source: string; started_at: string; finished_at: string; ok: number; detail: string | null }>()).results;
  return rows.map((r) => ({ id: r.id, job: r.job, source: r.source, startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok === 1, detail: r.detail }));
}

export async function pruneJobRuns(db: D1Database, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - JOB_RUN_RETENTION_DAYS * 86_400_000).toISOString();
  await db.prepare('DELETE FROM job_runs WHERE started_at<?').bind(cutoff).run();
}
