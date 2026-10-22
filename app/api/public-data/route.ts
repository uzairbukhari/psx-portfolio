import { db, failure, identity } from '@/lib/server';
import { readPublicData } from '@/lib/public-data-api';
import { serverTiming } from '@/lib/server-timing';

const headers = { 'Cache-Control': 'no-store' };

/** Cached public market data for the tickers named in `?tickers=`. Never reads a portfolio. */
export async function GET(req: Request) {
  try {
    await identity(req);
    const startedAt = Date.now();
    const data = await readPublicData(db(), new URL(req.url).searchParams.get('tickers'));
    const rows = data.quoteRows.length + data.announcements.length + data.corporateActions.length;
    return Response.json(data, { headers: { ...headers, ...serverTiming(startedAt, rows) } });
  } catch (e) {
    return failure(e, undefined, req);
  }
}
