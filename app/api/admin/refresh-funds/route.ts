import { refreshFunds } from '@/lib/mufap-refresh';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Super admin: fetch MUFAP's fund list and prices now (the cron Worker does this daily). */
export async function POST(req: Request) {
  try {
    await requireSuperAdmin(req, true);
    return Response.json(await refreshFunds(db()), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return failure(e);
  }
}
