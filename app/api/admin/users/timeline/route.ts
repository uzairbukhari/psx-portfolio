import { env } from 'cloudflare:workers';
import { logUserView, userTimeline } from '@/lib/admin-users-store';
import { db, failure, requireSuperAdmin } from '@/lib/server';
import { UserError } from '@/lib/user-error';

/** One account's recent events as sessions. Each lookup is written to `admin_actions`. */
export async function GET(req: Request) {
  try {
    const actor = await requireSuperAdmin(req);
    const email = new URL(req.url).searchParams.get('email') ?? '';
    if (!email.includes('@') || email.length > 200) throw new UserError('Invalid email.', 400);
    const timeline = await userTimeline(db(), env.SESSION_SECRET ?? '', email);
    if (!timeline) throw new UserError('No such account.', 404);
    await logUserView(db(), actor, email);
    return Response.json(timeline, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error, undefined, req); }
}
