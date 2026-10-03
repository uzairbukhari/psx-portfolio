import type { DividendRefreshResponse } from '@/lib/api-types';
import { db, identity, failure } from '@/lib/server';
import { dispatchConfig } from '@/lib/dispatch-config';
import { dividendRefreshStatus, requestDividendRefresh } from '@/lib/refresh-api';

const json = (body: DividendRefreshResponse) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });

/** Status of the historical announcement fetch for the tickers named in `?tickers=`, plus the cached announcements. */
export async function GET(req: Request) {
  try {
    await identity(req);
    return json(await dividendRefreshStatus(db(), new URL(req.url).searchParams.get('tickers'), dispatchConfig()));
  } catch (e) {
    return failure(e);
  }
}

/** Starts a fetch for the tickers in the body. The server never reads a portfolio to decide them. */
export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    const body = (await req.json().catch(() => ({}))) as { tickers?: unknown };
    return json(await requestDividendRefresh(db(), user, body.tickers, dispatchConfig()));
  } catch (e) {
    return failure(e);
  }
}
