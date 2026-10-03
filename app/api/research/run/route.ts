import { db, failure, requireSuperAdmin } from '@/lib/server';
import { validateInvestmentDossier } from '@/lib/research-policy.mjs';
import {
  addEvent,
  publicJob,
  RESEARCH_STAGES,
  type ResearchJobRow,
} from '@/lib/research-jobs';
import { UserError } from '@/lib/user-error';

const textValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

function dossierResult(value: unknown, ticker: string) {
  if (!value || typeof value !== 'object')
    throw new UserError('The dossier result is missing.');
  const details = value as Record<string, unknown>;
  if (
    details.ticker !== ticker ||
    !textValue(details.name).trim()
  )
    throw new UserError('The dossier company does not match the research job.');
  if (details.schemaVersion !== 2 || details.status !== 'Complete')
    throw new UserError('The run must submit a completed version 2 dossier.');
  if (!Array.isArray(details.financials) || !Array.isArray(details.documents))
    throw new UserError('The dossier is missing financials or source documents.');
  if (!Array.isArray(details.scoreRubric) || details.scoreRubric.length !== 7)
    throw new UserError('The dossier must use the seven-category scorecard.');
  const scores = details.scores as unknown[];
  if (!Array.isArray(scores) || scores.length !== 7)
    throw new UserError(
      'The dossier must contain seven score values, including nulls.',
    );
  for (const document of details.documents as Array<Record<string, unknown>>) {
    if (!/^https?:\/\//.test(textValue(document.url)))
      throw new UserError('Every dossier document must retain an official source URL.');
  }
  validateInvestmentDossier(details, details.price);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(details.priceDate))) throw new UserError('A dated reference quote is required.');
  return details;
}

/**
 * Marks the job complete with its validated dossier. Nothing here touches a portfolio: the dossier is public
 * company research, stored on the job, and the unlocked client applies it to its own encrypted portfolio.
 */
async function completeJob(row: ResearchJobRow, details: Record<string, unknown>) {
  const now = new Date().toISOString();
  const done = await db()
    .prepare("UPDATE research_jobs SET status='complete',stage='complete',message='Research complete',result=?,checkpoint=NULL,lease_owner=NULL,lease_until=NULL,completed_at=?,updated_at=? WHERE id=? AND status='researching' AND cancel_requested=0 AND lease_owner=?")
    .bind(JSON.stringify(details), now, now, row.id, row.lease_owner)
    .run();
  if (!done.meta.changes) throw new UserError('Research was cancelled or claimed by another tab while saving. The saved analysis can be uploaded again without another AI call.');
  await addEvent(row.id, 'complete', 'Research complete. The dossier is ready to read.');
}

// Claims the next queued/stale-leased job for the signed-in user's browser
// tab and reports its progress back — this is the in-browser research
// runner's counterpart to the old Mac helper's poll loop.
export async function POST(req: Request) {
  try {
    const userId = await requireSuperAdmin(req, true);
    const body = (await req.json()) as {
      action?:
        | 'claim'
        | 'progress'
        | 'heartbeat'
        | 'complete'
        | 'attention'
        | 'cancelled';
      runnerId?: string;
      id?: string;
      stage?: string;
      message?: string;
      reportsFound?: number;
      checkpoint?: unknown;
      dossier?: unknown;
      error?: string;
      companyName?: string;
      sector?: string;
    };
    const runnerId = String(body.runnerId || '');
    if (!runnerId) throw new UserError('A runner id is required.');

    if (body.action === 'claim') {
      const now = new Date().toISOString();
      const leaseUntil = new Date(Date.now() + 120_000).toISOString();
      const candidate = await db()
        .prepare(
          "SELECT * FROM research_jobs WHERE user_id=? AND cancel_requested=0 AND (status='queued' OR (status='researching' AND lease_until<?)) ORDER BY created_at LIMIT 1",
        )
        .bind(userId, now)
        .first<ResearchJobRow>();
      if (!candidate) return Response.json({ job: null });
      const claimed = await db()
        .prepare(
          "UPDATE research_jobs SET status='researching',stage=CASE WHEN status='queued' THEN 'verifying' ELSE stage END,message=CASE WHEN status='queued' THEN 'Verifying company' ELSE message END,lease_owner=?,lease_until=?,started_at=COALESCE(started_at,?),updated_at=? WHERE id=? AND (status='queued' OR lease_until<?)",
        )
        .bind(runnerId, leaseUntil, now, now, candidate.id, now)
        .run();
      if (!claimed.meta.changes) return Response.json({ job: null });
      const row = await db()
        .prepare('SELECT * FROM research_jobs WHERE id=?')
        .bind(candidate.id)
        .first<ResearchJobRow>();
      if (candidate.status === 'queued')
        await addEvent(candidate.id, 'verifying', 'Research started.');
      return Response.json({
        job: {
          ...publicJob(row!),
          checkpoint: row!.checkpoint ? JSON.parse(row!.checkpoint) : null,
        },
      });
    }

    const row = await db()
      .prepare('SELECT * FROM research_jobs WHERE id=? AND user_id=?')
      .bind(body.id, userId)
      .first<ResearchJobRow>();
    if (!row) throw new UserError('Research job was not found.');
    if (row.status === 'complete' && body.action === 'complete') return Response.json({ complete: true });
    if (row.status !== 'researching' || row.lease_owner !== runnerId)
      throw new UserError('This job is being processed by another browser tab.');
    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + 120_000).toISOString();
    if (row.cancel_requested || body.action === 'cancelled') {
      await db()
        .prepare(
          "UPDATE research_jobs SET status='cancelled',stage='cancelled',message='Research cancelled',lease_owner=NULL,lease_until=NULL,updated_at=?,completed_at=? WHERE id=?",
        )
        .bind(now, now, row.id)
        .run();
      await addEvent(
        row.id,
        'cancelled',
        'Research stopped at a safe checkpoint.',
      );
      return Response.json({ cancelled: true });
    }
    if (body.action === 'complete') {
      const details = dossierResult(
        body.dossier,
        row.ticker,
      );
      if (body.companyName) {
        row.company_name = body.companyName.slice(0, 150);
        await db()
          .prepare(
            'UPDATE research_jobs SET company_name=?,sector=? WHERE id=?',
          )
          .bind(
            row.company_name,
            String(body.sector || row.sector).slice(0, 100),
            row.id,
          )
          .run();
      }
      await completeJob(row, details);
      return Response.json({ complete: true });
    }
    if (body.action === 'attention') {
      const error = String(
        body.error || body.message || 'Research needs attention.',
      ).slice(0, 1000);
      await db()
        .prepare(
          "UPDATE research_jobs SET status='needs_attention',stage='needs_attention',message=?,error=?,checkpoint=?,lease_owner=NULL,lease_until=NULL,updated_at=? WHERE id=?",
        )
        .bind(
          error,
          error,
          body.checkpoint == null
            ? row.checkpoint
            : JSON.stringify(body.checkpoint),
          now,
          row.id,
        )
        .run();
      await addEvent(row.id, 'needs_attention', error);
      return Response.json({ paused: true });
    }
    if (body.action === 'heartbeat') {
      await db()
        .prepare(
          'UPDATE research_jobs SET lease_until=?,updated_at=? WHERE id=?',
        )
        .bind(leaseUntil, now, row.id)
        .run();
      return Response.json({ cancelRequested: !!row.cancel_requested });
    }
    if (
      body.action !== 'progress' ||
      !RESEARCH_STAGES.includes(body.stage as never)
    )
      throw new UserError('Invalid run update.');
    const message = String(body.message || '').slice(0, 1000);
    await db()
      .prepare(
        'UPDATE research_jobs SET stage=?,message=?,reports_found=?,checkpoint=?,lease_until=?,updated_at=? WHERE id=?',
      )
      .bind(
        String(body.stage),
        message,
        Math.max(
          0,
          Math.min(100, Number(body.reportsFound ?? row.reports_found)),
        ),
        body.checkpoint == null
          ? row.checkpoint
          : JSON.stringify(body.checkpoint),
        leaseUntil,
        now,
        row.id,
      )
      .run();
    await addEvent(row.id, String(body.stage), message);
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
