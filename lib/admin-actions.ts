// The few things the admin console may do, each from a fixed list and each written to `admin_actions`. Nothing here takes
// free text that reaches a query, a URL or a shell: workflows come from the pipeline registry, queue rows from fixed kinds.
import { PIPELINES } from './pipelines.ts';
import { dispatchWorkflow, type DispatchSettings } from './scrape-schedule.ts';
import { recordJobRun } from './job-runs.ts';

export type AdminActionRequest =
  | { action: 'run-workflow'; workflow: string }
  | { action: 'retry-stuck' }
  | { action: 'cancel-stuck' };
export type AdminActionResult = { ok: boolean; message: string };

export const STUCK_MINUTES = 15;

export function workflowAllowed(workflow: unknown): workflow is string {
  return typeof workflow === 'string' && PIPELINES.some((p) => p.workflow === workflow);
}

export function parseAction(body: unknown): AdminActionRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.action === 'run-workflow' && workflowAllowed(b.workflow)) return { action: 'run-workflow', workflow: b.workflow };
  if (b.action === 'retry-stuck' || b.action === 'cancel-stuck') return { action: b.action };
  return null;
}

async function log(db: D1Database, actor: string, action: string, target: string, result: string) {
  await db.prepare('INSERT INTO admin_actions (at,actor,action,target,result) VALUES (?,?,?,?,?)')
    .bind(new Date().toISOString(), actor, action, target, result).run();
}

export async function runAdminAction(
  db: D1Database, actor: string, req: AdminActionRequest, settings: DispatchSettings, now = new Date(),
): Promise<AdminActionResult> {
  let result: AdminActionResult;
  let target = '';
  if (req.action === 'run-workflow') {
    target = req.workflow;
    const error = await dispatchWorkflow(settings, req.workflow);
    result = error ? { ok: false, message: `Could not start ${req.workflow}: ${error}.` } : { ok: true, message: `Started ${req.workflow}. It appears in the run history when it finishes.` };
    const job = PIPELINES.find((p) => p.workflow === req.workflow)?.id;
    if (job && !error) await recordJobRun(db, { job, source: 'admin', startedAt: now.toISOString(), ok: true, detail: 'Started from the admin console' }).catch(() => {});
  } else {
    target = 'refresh_requests';
    const cutoff = new Date(now.getTime() - STUCK_MINUTES * 60_000).toISOString();
    const stamp = now.toISOString();
    const stmt = req.action === 'retry-stuck'
      ? db.prepare("UPDATE refresh_requests SET status='queued', requested_at=?, started_at=NULL, error=NULL WHERE status IN ('queued','running') AND requested_at<?").bind(stamp, cutoff)
      : db.prepare("UPDATE refresh_requests SET status='failed', completed_at=?, error='Cancelled from the admin console' WHERE status IN ('queued','running') AND requested_at<?").bind(stamp, cutoff);
    const changed = (await stmt.run()).meta?.changes ?? 0;
    result = { ok: true, message: `${changed} stuck request${changed === 1 ? '' : 's'} ${req.action === 'retry-stuck' ? 'queued again' : 'cancelled'}.` };
  }
  await log(db, actor, req.action, target, result.ok ? 'ok' : result.message.slice(0, 200)).catch(() => {});
  return result;
}

export type AdminActionRow = { at: string; actor: string; action: string; target: string | null; result: string };
export async function recentAdminActions(db: D1Database, limit = 50): Promise<AdminActionRow[]> {
  const n = Math.max(1, Math.min(200, Math.trunc(limit)));
  return (await db.prepare(`SELECT at,actor,action,target,result FROM admin_actions ORDER BY id DESC LIMIT ${n}`).all<AdminActionRow>()).results;
}
