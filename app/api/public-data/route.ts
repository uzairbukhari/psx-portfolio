import { db, failure, identity } from '@/lib/server';
import { readPublicData } from '@/lib/public-data-api';

const headers = { 'Cache-Control': 'no-store' };

/** Cached public market data for the tickers named in `?tickers=`. Never reads a portfolio. */
export async function GET(req: Request) {
  try {
    await identity(req);
    return Response.json(await readPublicData(db(), new URL(req.url).searchParams.get('tickers')), { headers });
  } catch (e) {
    return failure(e);
  }
}
