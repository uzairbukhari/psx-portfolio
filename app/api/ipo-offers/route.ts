import { db, identity, failure } from '@/lib/server';
import { dispatchConfig } from '@/lib/dispatch-config';
import { ipoStatus, requestIpoLookup } from '@/lib/refresh-api';

const headers = { 'Cache-Control': 'no-store' };

/** Official IPO offer evidence (curated or scraped) for up to five symbols: ?tickers=JSRR,ABCD */
export async function GET(req: Request) {
  try {
    await identity(req);
    const tickers = new URL(req.url).searchParams.get('tickers');
    return Response.json(await ipoStatus(db(), tickers, dispatchConfig()), { headers });
  } catch (e) {
    return failure(e);
  }
}

/** Asks GitHub Actions to look the symbols up in PSX's official offer documents. */
export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    const body = (await req.json().catch(() => ({}))) as { tickers?: unknown };
    return Response.json(await requestIpoLookup(db(), user, body.tickers, dispatchConfig()), { headers });
  } catch (e) {
    return failure(e);
  }
}
