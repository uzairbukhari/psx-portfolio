import { db, failure, identity } from '@/lib/server';
import { readPlanNavs, refreshPlanNavs } from '@/lib/plan-navs';
import { today } from '@/lib/portfolio';

/** Pak-Qatar sub-fund unit prices. Takes no parameters, so the request says nothing about what anyone holds. */
export async function GET(req: Request) {
  try {
    await identity(req);
    let error: string | undefined;
    let navs = await readPlanNavs(db(), today());
    if (!navs.length) {
      // Nothing stored yet (the nightly run has not happened): fetch the public page once, then read again.
      await refreshPlanNavs(db()).catch((e) => {
        console.error('Pak-Qatar price fetch failed', e);
        error = e instanceof Error ? e.message : 'Could not fetch the prices.';
      });
      navs = await readPlanNavs(db(), today());
    }
    return Response.json(
      { navs, error },
      { headers: { 'Cache-Control': 'private, max-age=900' } },
    );
  } catch (e) {
    return failure(e);
  }
}
