import { db, failure, identity } from '@/lib/server';
import { readFundCatalog, readFundHistory } from '@/lib/fund-store';
import { UserError } from '@/lib/user-error';

/**
 * Mutual fund directory with the newest price of every fund; with `?fund=<MUFAP id>` that one fund's price history
 * instead. Fund names are public, and no amount, unit count or date of yours is ever part of the request.
 */
export async function GET(req: Request) {
  try {
    await identity(req);
    const fund = new URL(req.url).searchParams.get('fund');
    if (fund !== null && !/^\d{1,8}$/.test(fund)) throw new UserError('Invalid fund id.');
    const body = fund === null ? await readFundCatalog(db()) : await readFundHistory(db(), fund);
    return Response.json(body, { headers: { 'Cache-Control': 'private, max-age=900' } });
  } catch (e) {
    return failure(e);
  }
}
