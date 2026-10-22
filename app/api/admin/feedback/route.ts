import { FEEDBACK_STATUSES, listFeedback, updateFeedback } from '@/lib/feedback';
import { readLimited } from '@/lib/read-limited';
import { db, failure, requireSuperAdmin } from '@/lib/server';
import { UserError } from '@/lib/user-error';

/** Feedback inbox for the super admin: list (newest first, optional status) and set status or a private note. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const q = new URL(req.url).searchParams;
    const status = FEEDBACK_STATUSES.find((s) => s === q.get('status'));
    return Response.json(await listFeedback(db(), { status, offset: Number(q.get('offset') ?? 0) }), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, undefined, req); }
}

export async function POST(req: Request) {
  try {
    await requireSuperAdmin(req, true);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(new TextDecoder().decode(await readLimited(req, 4_000, 'Request is too large.'))) as Record<string, unknown>;
    } catch {
      throw new UserError('Invalid request.', 400);
    }
    if (!(await updateFeedback(db(), Number(body.id), { status: body.status, note: body.note }))) throw new UserError('Nothing to update.', 400);
    return Response.json({ ok: true });
  } catch (error) { return failure(error, undefined, req); }
}
