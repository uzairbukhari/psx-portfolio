import { env } from 'cloudflare:workers';
import { ERROR_AREAS, ERROR_CODES } from '@/lib/error-codes';
import { auditLog } from '@/lib/analytics-store';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Audit log for the super admin: client errors by category, code, screen and user. Categories and codes only, never message text. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const q = new URL(req.url).searchParams;
    const area = q.get('area') ?? undefined;
    const code = q.get('code') ?? undefined;
    const email = q.get('user')?.trim() || undefined;
    const report = await auditLog(db(), {
      days: Number(q.get('days') ?? 7),
      area: area && (ERROR_AREAS as readonly string[]).includes(area) ? area : undefined,
      code: code && (ERROR_CODES as readonly string[]).includes(code) ? code : undefined,
      userEmail: email,
      includeAdmin: q.get('admin') === '1',
    }, env.SESSION_SECRET ?? '');
    return Response.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
