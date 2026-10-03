import { db, identity, failure } from '@/lib/server';
import { dispatchConfig } from '@/lib/dispatch-config';
import { faceValueStatus, requestFaceValues } from '@/lib/face-value-api';
import { UserError } from '@/lib/user-error';

const headers = { 'Cache-Control': 'no-store' };

/** Verified face-value evidence and fetch status for the tickers named in `?tickers=`. */
export async function GET(req: Request) {
  try {
    await identity(req);
    return Response.json(await faceValueStatus(db(), new URL(req.url).searchParams.get('tickers'), dispatchConfig()), { headers });
  } catch (e) {
    return failure(e);
  }
}

/** Queues a background lookup for the named tickers that have no verified face value. */
export async function POST(req: Request) {
  try {
    const user = await identity(req, true);
    let body: { tickers?: unknown } = {};
    try {
      body = (await req.json()) as { tickers?: unknown };
    } catch {
      body = {};
    }
    if (body && typeof body !== 'object') throw new UserError('Invalid request.');
    return Response.json(await requestFaceValues(db(), user, body.tickers, dispatchConfig()), { headers });
  } catch (e) {
    return failure(e);
  }
}
