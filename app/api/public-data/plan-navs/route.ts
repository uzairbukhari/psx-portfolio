import { waitUntil } from 'cloudflare:workers';
import { edgeCached } from '@/lib/edge-cache';
import { db, failure, identity } from '@/lib/server';
import { readPlanNavs, refreshPlanNavs } from '@/lib/plan-navs';
import { today } from '@/lib/portfolio';

/** Pak-Qatar sub-fund unit prices. Takes no parameters, so the request says nothing about what anyone holds. */
export async function GET(req: Request) {
  try {
    await identity(req);
    // Public and identical for everyone, and the prices change once a day. A throw (nothing stored, fetch failed) is
    // never cached, so the next request tries again.
    let error: string | undefined;
    let navs: Awaited<ReturnType<typeof readPlanNavs>>;
    try {
      navs = await edgeCached(
        'plan-navs',
        3600,
        async () => {
          let rows = await readPlanNavs(db(), today());
          if (!rows.length) {
            // Nothing stored yet (the nightly run has not happened): fetch the public page once, then read again.
            await refreshPlanNavs(db()).catch((e) => {
              console.error('Pak-Qatar price fetch failed', e);
              error = e instanceof Error ? e.message : 'Could not fetch the prices.';
            });
            rows = await readPlanNavs(db(), today());
          }
          if (!rows.length) throw new Error('empty');
          return rows;
        },
        waitUntil,
      );
    } catch {
      navs = [];
    }
    return Response.json(
      { navs, error },
      { headers: { 'Cache-Control': 'private, max-age=900' } },
    );
  } catch (e) {
    return failure(e, undefined, req);
  }
}
