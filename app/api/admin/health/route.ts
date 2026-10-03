import { db, failure, requireSuperAdmin } from '@/lib/server';
import { dataHealth } from '@/lib/data-health';

/** Operational health for administrators: data freshness and recent scrape failures. No private data is involved. */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    return Response.json(await dataHealth(db()), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
