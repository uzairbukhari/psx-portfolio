import { waitUntil } from 'cloudflare:workers';
import { db, failure, identity } from '@/lib/server';
import { edgeCached } from '@/lib/edge-cache';
import {
  readFundCatalog,
  readFundHistory,
  readFundPayouts,
} from '@/lib/fund-store';
import { freshenFunds, trackFunds } from '@/lib/mufap-refresh';
import { UserError } from '@/lib/user-error';

/**
 * Mutual fund directory with the newest price of every fund; with `?fund=<MUFAP id>` that one fund's price history
 * instead; with `?payouts=<id>,<id>` those funds' payouts. Fund names are public, and no amount, unit count or date of yours is ever part of the request.
 */
export async function GET(req: Request) {
  try {
    await identity(req);
    const params = new URL(req.url).searchParams;
    const payoutIds = params.get('payouts');
    if (payoutIds !== null)
      return Response.json(await readFundPayouts(db(), payoutIds.split(',')), {
        headers: { 'Cache-Control': 'private, max-age=900' },
      });
    const fund = params.get('fund');
    if (fund !== null && !/^\d{1,8}$/.test(fund))
      throw new UserError('Invalid fund id.');
    // Public and identical for everyone; MUFAP prices change once a day, so five minutes at the edge is safe.
    const body =
      fund === null
        ? await edgeCached('fund-catalog', 300, () => readFundCatalog(db()), waitUntil)
        : await edgeCached(`fund-history:${fund}`, 300, () => readFundHistory(db(), fund), waitUntil);
    return Response.json(body, {
      headers: { 'Cache-Control': 'private, max-age=900' },
    });
  } catch (e) {
    return failure(e, undefined, req);
  }
}

/**
 * Tells the server which funds are held, by public MUFAP id only, so their price is stored. With `{freshen:true}` (sent
 * on each web visit, nothing else in the body) it refreshes MUFAP's prices when they are stale: this is the only
 * automatic refresh, because MUFAP challenges fetches that no visitor started (see lib/mufap-refresh.ts).
 */
export async function POST(req: Request) {
  try {
    await identity(req, true);
    const body = (await req.json().catch(() => null)) as {
      mufapIds?: unknown;
      retry?: unknown;
      freshen?: unknown;
    } | null;
    if (body?.freshen === true)
      return Response.json(await freshenFunds(db()), {
        headers: { 'Cache-Control': 'no-store' },
      });
    return Response.json(
      await trackFunds(db(), body?.mufapIds, body?.retry === true),
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (e) {
    return failure(e, undefined, req);
  }
}
