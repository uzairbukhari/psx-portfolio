import { env } from 'cloudflare:workers';
import { parseAction, recentAdminActions, runAdminAction } from '@/lib/admin-actions';
import { db, failure, requireSuperAdmin } from '@/lib/server';
import { UserError } from '@/lib/user-error';

const noStore = { 'Cache-Control': 'no-store' };

/** Super admin: recent console actions (who did what), newest first. Includes account changes. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    return Response.json({ actions: await recentAdminActions(db(), 100) }, { headers: noStore });
  } catch (e) { return failure(e); }
}

/** Super admin: run one allowlisted operation (start a scraper workflow, retry or cancel stuck requests). */
export async function POST(req: Request) {
  try {
    const actor = await requireSuperAdmin(req, true);
    const action = parseAction(await req.json().catch(() => null));
    if (!action) throw new UserError('That action is not allowed.', 400);
    const result = await runAdminAction(db(), actor, action, {
      token: env.GITHUB_DISPATCH_TOKEN, repo: env.GITHUB_REPO, appEnv: env.APP_ENV,
    });
    return Response.json(result, { status: result.ok ? 200 : 502, headers: noStore });
  } catch (e) { return failure(e); }
}
