import { db, failure, identity } from '@/lib/server';
import {
  readFundCatalog,
  readFundHistory,
  readFundPayouts,
} from '@/lib/fund-store';
import { trackFunds } from '@/lib/mufap-refresh';
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
    const body =
      fund === null
        ? await readFundCatalog(db())
        : await readFundHistory(db(), fund);
    return Response.json(body, {
      headers: { 'Cache-Control': 'private, max-age=900' },
    });
  } catch (e) {
    return failure(e, undefined, req);
  }
}

/** Tells the server which funds are held, by public MUFAP id only, so their price is fetched every night. */
export async function POST(req: Request) {
  try {
    await identity(req, true);
    const body = (await req.json().catch(() => null)) as {
      mufapIds?: unknown;
      retry?: unknown;
    } | null;
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
