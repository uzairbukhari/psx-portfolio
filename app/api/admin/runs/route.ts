import { recentJobRuns } from '@/lib/job-runs';
import { PIPELINES } from '@/lib/pipelines';
import { db, failure, requireSuperAdmin } from '@/lib/server';

/** Super admin: recent runs of the public data jobs, optionally for one pipeline (`?job=quotes`). */
export async function GET(req: Request) {
  try {
    await requireSuperAdmin(req);
    const job = new URL(req.url).searchParams.get('job') ?? undefined;
    const known = job && PIPELINES.some((p) => p.id === job) ? job : undefined;
    return Response.json({ runs: await recentJobRuns(db(), known, 40) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(e, undefined, req); }
}
